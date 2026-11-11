/** @jest-environment node */
import { and, eq } from 'drizzle-orm';
import {
  applications,
  communications,
  emailAutomationAuditLog,
  emailAutomationPendingApprovals,
} from '../db/schema.js';
import * as engine from './emailClassificationEngine.js';
import type { EmailClassificationResult } from './emailClassificationTypes.js';
import { resolvePendingApproval, updatePipelineFromEmail } from './emailAutomationService.js';
import { buildPipelineUpdateProposal } from './emailPipelineAutomation.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import { buildStageChangeNote, appendStageChangeNote } from './stageChangeNote.js';
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';
import {
  CALENDLY_CONFIRMATION_SUBJECT,
  SCREENING_CALENDLY_URL,
  SCREENING_REQUEST_SUBJECT,
  NEXT_ROUND_SUBJECT,
  calendlyScreeningConfirmation,
  hiringManagerInterview,
  outlookNextRoundReply,
  outlookScreeningRequest,
} from './__fixtures__/outlookScreeningRequest.js';

jest.mock('./emailClassificationEngine.js', () => ({
  classifyInboundEmailWithLlm: jest.fn(),
  classifyInboundEmailWithRules: jest.requireActual('./emailClassificationEngine.js')
    .classifyInboundEmailWithRules,
}));

type Db = ReturnType<typeof createTestDb>;

const FORWARDER = 'steve@terapak.com';
const APP_ID = 'app-grocer';
const ROLE = 'Senior Engineering Manager, DC Buying';

// The shape the LLM returned in prod for this email.
const screeningShape: EmailClassificationResult = {
  classification: 'Interview Request',
  classificationConfidence: 95,
  companyName: 'Example Grocer',
  positionTitle: ROLE,
  recruiterName: 'Alex Rivera',
  requiresResponse: true,
  suggestedAction: 'Schedule the interview using the provided Calendly link',
  actionDueAt: null,
  interviewDetected: true,
  interviewDatetime: null,
  aiSummary: 'The recruiter asks to schedule a 30-minute screening call.',
};

function setup(options: {
  status?: string;
  shape?: EmailClassificationResult;
  subject?: string;
  textBody?: string;
} = {}) {
  jest.mocked(engine.classifyInboundEmailWithLlm).mockResolvedValue(options.shape ?? screeningShape);
  const db = createTestDb();
  const userId = seedTestUser(db, { email: FORWARDER });
  seedApplication(db, userId, {
    id: APP_ID,
    company: 'Example Grocer',
    roleTitle: ROLE,
    status: (options.status ?? 'applied') as never,
    dateApplied: '2026-11-09',
  });
  db.update(applications)
    .set({ notes: 'Confirms receipt of your application.' })
    .where(eq(applications.id, APP_ID))
    .run();
  const id = seedInboundEmail(db, {
    id: 'email-screening',
    fromEmail: FORWARDER,
    toEmail: 'jobinfo@jobs.example',
    subject: options.subject ?? SCREENING_REQUEST_SUBJECT,
    payload: JSON.stringify({
      FromName: 'Steve Terapak',
      TextBody: options.textBody ?? outlookScreeningRequest,
    }),
  });
  return { db, userId, id };
}

const app = (db: Db) => db.select().from(applications).where(eq(applications.id, APP_ID)).all()[0];

const pipelineApprovals = (db: Db) =>
  db
    .select()
    .from(emailAutomationPendingApprovals)
    .where(eq(emailAutomationPendingApprovals.approvalType, 'pipeline_update'))
    .all();

describe('a recruiter screening request (AC1)', () => {
  it('queues an update to Recruiter Screen, not Interviewing', async () => {
    const { db, userId, id } = setup();
    await processInboundEmail(db, id, { userId });

    const queued = pipelineApprovals(db);
    expect(queued).toHaveLength(1);
    expect(queued[0].proposedStatus).toBe('recruiter_screen');
    expect(queued[0].suggestedAction).toBe('Update pipeline to Recruiter Screen');
  });

  it('on approval moves to Recruiter Screen and adds one dated note with the recruiter and link', async () => {
    const { db, userId, id } = setup();
    await processInboundEmail(db, id, { userId });
    const approvalId = pipelineApprovals(db)[0].id;

    resolvePendingApproval(db, userId, approvalId, 'approved');

    const after = app(db);
    expect(after.status).toBe('recruiter_screen');
    expect(after.notes.startsWith('Confirms receipt of your application.\n')).toBe(true);
    const added = after.notes.split('\n').slice(1);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(
      /^\[\d{4}-\d{2}-\d{2}\] Recruiter Screen requested by Alex Rivera \(Example Grocer\)\. Schedule: https:\/\/calendly\.com\/example-talent$/,
    );

    // A second approval of the same item is a no-op.
    expect(resolvePendingApproval(db, userId, approvalId, 'approved')).toBeNull();
    expect(app(db).notes).toBe(after.notes);
  });
});

describe('the same screening when the application is already further along (AC2)', () => {
  it('queues no pipeline update and still logs the communication', async () => {
    const { db, userId, id } = setup({ status: 'interviewing' });
    await processInboundEmail(db, id, { userId });

    expect(pipelineApprovals(db)).toHaveLength(0);
    expect(app(db).status).toBe('interviewing');
    const comms = db.select().from(communications).where(eq(communications.applicationId, APP_ID)).all();
    expect(comms).toHaveLength(1);
  });
});

describe('stage mapping (R1)', () => {
  const propose = (emailText: string, classification = 'Interview Request') =>
    buildPipelineUpdateProposal({
      applicationId: APP_ID,
      currentStatus: 'applied',
      classification,
      classificationConfidence: 95,
      interviewDetected: true,
      emailText,
    })?.proposedStatus;

  it('a hiring-team interview goes to Interviewing (AC3)', () => {
    expect(propose(hiringManagerInterview)).toBe('interviewing');
  });

  it('a screening request goes to Recruiter Screen', () => {
    expect(propose(outlookScreeningRequest)).toBe('recruiter_screen');
  });

  it('without email text the previous mapping holds', () => {
    expect(
      buildPipelineUpdateProposal({
        applicationId: APP_ID,
        currentStatus: 'applied',
        classification: 'Interview Request',
        classificationConfidence: 95,
        interviewDetected: true,
      })?.proposedStatus,
    ).toBe('interviewing');
  });
});

describe('the Calendly booking confirmation for the screening', () => {
  it('keeps the application at Recruiter Screen', async () => {
    const { db, userId, id } = setup({
      status: 'recruiter_screen',
      subject: CALENDLY_CONFIRMATION_SUBJECT,
      textBody: calendlyScreeningConfirmation,
      shape: {
        ...screeningShape,
        classification: 'Scheduling',
        requiresResponse: false,
        interviewDatetime: '2026-11-12T18:00:00.000Z',
        aiSummary: 'A 30 minute initial screening is booked for Nov 12.',
      },
    });
    await processInboundEmail(db, id, { userId });

    expect(app(db).status).toBe('recruiter_screen');
  });
});

describe('a later reply in the same thread', () => {
  it('reads only the newest message, not the quoted screening request', async () => {
    const { db, userId, id } = setup({
      status: 'recruiter_screen',
      subject: NEXT_ROUND_SUBJECT,
      textBody: outlookNextRoundReply,
    });
    await processInboundEmail(db, id, { userId });

    const queued = pipelineApprovals(db);
    expect(queued).toHaveLength(1);
    expect(queued[0].proposedStatus).toBe('interviewing');
  });
});

describe('a recruiter whose title names a director', () => {
  it('still reads a screening request as a screen', () => {
    const signed = `${outlookScreeningRequest}\nAlex Rivera\nDirector of Talent Acquisition\n`;
    expect(
      buildPipelineUpdateProposal({
        applicationId: APP_ID,
        currentStatus: 'applied',
        classification: 'Interview Request',
        classificationConfidence: 95,
        interviewDetected: true,
        emailText: signed,
      })?.proposedStatus,
    ).toBe('recruiter_screen');
  });
});

describe('no backward moves', () => {
  it('rechecks the stage when an approval is applied', async () => {
    const { db, userId, id } = setup();
    await processInboundEmail(db, id, { userId });
    const approvalId = pipelineApprovals(db)[0].id;
    db.update(applications).set({ status: 'interviewing' }).where(eq(applications.id, APP_ID)).run();

    const result = resolvePendingApproval(db, userId, approvalId, 'approved');

    expect(result?.success).toBe(false);
    expect(app(db).status).toBe('interviewing');
    const audit = db
      .select()
      .from(emailAutomationAuditLog)
      .where(and(eq(emailAutomationAuditLog.actionType, 'update_pipeline'), eq(emailAutomationAuditLog.status, 'rejected')))
      .all();
    expect(audit.some((a) => a.detailsJson.includes('stage_already_past'))).toBe(true);
  });

  it('an explicit automated status never moves an application backward', () => {
    const { db, userId, id } = setup({ status: 'interviewing' });
    const result = updatePipelineFromEmail(db, userId, id, {
      applicationId: APP_ID,
      status: 'applied',
      force: true,
    });
    expect(result?.success).toBe(false);
    expect(app(db).status).toBe('interviewing');
  });

  it('a manual override can still move it backward', () => {
    const { db, userId, id } = setup({ status: 'interviewing' });
    updatePipelineFromEmail(db, userId, id, {
      applicationId: APP_ID,
      status: 'applied',
      force: true,
      allowBackward: true,
    });
    expect(app(db).status).toBe('applied');
  });
});

describe('declining a non-pipeline approval (R4)', () => {
  it('is logged under its own action type', async () => {
    const { db, userId, id } = setup();
    await processInboundEmail(db, id, { userId });
    const draft = db
      .select()
      .from(emailAutomationPendingApprovals)
      .where(eq(emailAutomationPendingApprovals.approvalType, 'draft_reply'))
      .all()[0];

    resolvePendingApproval(db, userId, draft.id, 'rejected');

    const rows = db
      .select()
      .from(emailAutomationAuditLog)
      .where(eq(emailAutomationAuditLog.status, 'rejected'))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].actionType).toBe('draft_reply');
  });
});

describe('stage change note (R2)', () => {
  it('names the recruiter, company and scheduling link', () => {
    expect(
      buildStageChangeNote({
        date: '2026-11-11',
        status: 'recruiter_screen',
        senderName: 'Alex Rivera',
        company: 'Example Grocer',
        text: outlookScreeningRequest,
      }),
    ).toBe(
      `[2026-11-11] Recruiter Screen requested by Alex Rivera (Example Grocer). Schedule: ${SCREENING_CALENDLY_URL}`,
    );
  });

  it('works without a name or link', () => {
    expect(
      buildStageChangeNote({
        date: '2026-11-11',
        status: 'interviewing',
        senderName: null,
        company: 'Example Grocer',
        text: 'no links here',
      }),
    ).toBe('[2026-11-11] Interviewing requested via email (Example Grocer).');
  });

  it('uses neutral wording for stages nobody requests', () => {
    expect(
      buildStageChangeNote({
        date: '2026-11-11',
        status: 'rejected',
        senderName: 'Alex Rivera',
        company: 'Example Grocer',
        text: '',
      }),
    ).toBe('[2026-11-11] Moved to Rejected after email from Alex Rivera (Example Grocer).');
  });

  it('is not appended twice, even on a later day', () => {
    const line = (date: string) =>
      buildStageChangeNote({
        date,
        status: 'recruiter_screen',
        senderName: 'Alex Rivera',
        company: 'Example Grocer',
        text: outlookScreeningRequest,
      });
    const once = appendStageChangeNote('Old note', line('2026-11-11'));
    expect(appendStageChangeNote(once, line('2026-11-12'))).toBe(once);
    expect(appendStageChangeNote('', line('2026-11-11'))).toBe(line('2026-11-11'));
  });
});
