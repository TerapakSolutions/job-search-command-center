/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { applications, inboundEmails } from '../db/schema.js';
import { classifyEmailContent } from './emailClassificationService.js';
import * as engine from './emailClassificationEngine.js';
import type { EmailClassificationResult } from './emailClassificationTypes.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';
import {
  ALREADY_SUBMITTED_SUBJECT,
  outlookAlreadySubmittedElsewhere,
} from './__fixtures__/outlookAlreadySubmittedElsewhere.js';
import { outlookOutboundTopNoNote } from './__fixtures__/outlookOutboundTopMessage.js';

jest.mock('./emailClassificationEngine.js', () => ({
  classifyInboundEmailWithLlm: jest.fn(),
  classifyInboundEmailWithRules: jest.requireActual('./emailClassificationEngine.js')
    .classifyInboundEmailWithRules,
}));

const mockLlm = jest.mocked(engine.classifyInboundEmailWithLlm);
const { classifyInboundEmailWithRules } = jest.requireActual<typeof engine>(
  './emailClassificationEngine.js',
);

const FORWARDER = 'steve@terapak.com';
const LABEL = 'Already Submitted Elsewhere';

function llmResult(overrides: Partial<EmailClassificationResult>): EmailClassificationResult {
  return {
    classification: 'Other',
    classificationConfidence: 80,
    companyName: null,
    positionTitle: null,
    recruiterName: null,
    requiresResponse: false,
    suggestedAction: 'Review',
    actionDueAt: null,
    interviewDetected: false,
    interviewDatetime: null,
    aiSummary: 'Summary.',
    ...overrides,
  };
}

const classify = () =>
  classifyEmailContent({
    subject: ALREADY_SUBMITTED_SUBJECT,
    fromEmail: FORWARDER,
    fromName: 'Steve Terapak',
    textBody: outlookAlreadySubmittedElsewhere,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockLlm.mockResolvedValue(null);
});

describe('the forwarder telling a second vendor they are already submitted', () => {
  it('is labelled Already Submitted Elsewhere on the rules path (no LLM)', async () => {
    const result = await classify();
    expect(result.classification).toBe(LABEL);
    expect(result.requiresResponse).toBe(false);
  });

  it('wins over the LLM labelling it Agreed to Submission (the prod case), keeping its company and role', async () => {
    mockLlm.mockResolvedValue(
      llmResult({
        classification: 'Agreed to Submission',
        classificationConfidence: 95,
        companyName: 'Example Insurer',
        positionTitle: 'Solution Architect',
        suggestedAction: 'Consider other roles for the candidate',
      }),
    );
    const result = await classify();
    expect(result.classification).toBe(LABEL);
    expect(result.companyName).toBe('Example Insurer');
    expect(result.positionTitle).toBe('Solution Architect');
    expect(result.requiresResponse).toBe(false);
  });

  it('suggests keeping the second vendor for other roles, by name', async () => {
    const result = await classify();
    expect(result.recruiterName).toBe('Priya Nair');
    expect(result.suggestedAction).toBe(
      'Already submitted through another vendor. Keep Priya Nair in mind for other roles',
    );
  });

  it('changes nothing on the matched application', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: FORWARDER });
    seedApplication(db, userId, {
      id: 'app-insurer',
      company: 'Example Insurer',
      roleTitle: 'Solution Architect',
      status: 'recruiter_screen',
      updatedAt: '2026-11-10T23:10:00.000Z',
    });
    db.update(applications)
      .set({ agency: 'First Vendor' })
      .where(eq(applications.id, 'app-insurer'))
      .run();
    const before = db.select().from(applications).where(eq(applications.id, 'app-insurer')).all()[0];

    const id = seedInboundEmail(db, {
      id: 'email-already-submitted',
      fromEmail: FORWARDER,
      toEmail: 'jobinfo@jobs.example',
      subject: ALREADY_SUBMITTED_SUBJECT,
      payload: JSON.stringify({
        FromName: 'Steve Terapak',
        TextBody: outlookAlreadySubmittedElsewhere,
      }),
    });
    await processInboundEmail(db, id, { userId });

    const row = db.select().from(inboundEmails).where(eq(inboundEmails.id, id)).all()[0];
    expect(row.classification).toBe(LABEL);
    const after = db.select().from(applications).where(eq(applications.id, 'app-insurer')).all()[0];
    expect(after).toEqual(before);
  });
});

describe('controls', () => {
  it('an agreement to be submitted is still Agreed to Submission', async () => {
    const result = await classifyEmailContent({
      subject: 'FW: Solution Architect !! Location:  Example City !!',
      fromEmail: FORWARDER,
      textBody: outlookOutboundTopNoNote,
    });
    expect(result.classification).toBe('Agreed to Submission');
  });

  it('"please don\'t submit my profile" is never Agreed to Submission', () => {
    const result = classifyInboundEmailWithRules({
      subject: 'RE: Solution Architect',
      fromEmail: FORWARDER,
      textBody: "Hi Priya, I'm open to moving forward elsewhere, but please don't submit my profile here.",
      writtenByCandidate: true,
    });
    expect(result.classification).not.toBe('Agreed to Submission');
  });

  it('a recruiter writing "already submitted" is not this label, even if the LLM says so', async () => {
    mockLlm.mockResolvedValue(llmResult({ classification: LABEL }));
    const result = await classifyEmailContent({
      subject: 'Solution Architect update',
      fromEmail: 'priya.nair@vendortwo.example',
      textBody: 'Hi Steve, I have already submitted your profile to the client. I will update you soon.',
    });
    expect(result.classification).not.toBe(LABEL);
  });

  it.each([
    "I've already submitted my updated resume, aligned to the job description.",
    'I already submitted the skills matrix you asked for.',
  ])('the candidate sending their own documents is not this label: %s', (textBody) => {
    const result = classifyInboundEmailWithRules({
      subject: 'RE: Solution Architect',
      fromEmail: FORWARDER,
      textBody,
      writtenByCandidate: true,
    });
    expect(result.classification).not.toBe(LABEL);
  });

  it('the rule needs a message the candidate wrote', () => {
    const result = classifyInboundEmailWithRules({
      subject: 'RE: Solution Architect',
      fromEmail: 'priya.nair@vendortwo.example',
      textBody: "You've already been submitted through another vendor, so we can't submit you.",
    });
    expect(result.classification).not.toBe(LABEL);
  });
});

describe('email detail: who the forward was written by', () => {
  it('flags a forward whose top message the job seeker wrote', async () => {
    const { getInboundEmailDetailForUser } = await import('./inboundEmailService.js');
    const db = createTestDb();
    const userId = seedTestUser(db, { email: FORWARDER });
    const id = seedInboundEmail(db, {
      id: 'email-detail-outbound',
      fromEmail: FORWARDER,
      toEmail: 'jobinfo@jobs.example',
      subject: ALREADY_SUBMITTED_SUBJECT,
      payload: JSON.stringify({ FromName: 'Steve Terapak', TextBody: outlookAlreadySubmittedElsewhere }),
    });
    db.update(inboundEmails).set({ isForwarded: true }).where(eq(inboundEmails.id, id)).run();
    expect(getInboundEmailDetailForUser(db, userId, id)?.forwarded.writtenByYou).toBe(true);
  });

  it('control: a forward of a recruiter\'s message is not flagged', async () => {
    const { getInboundEmailDetailForUser } = await import('./inboundEmailService.js');
    const db = createTestDb();
    const userId = seedTestUser(db, { email: FORWARDER });
    const inbound = outlookAlreadySubmittedElsewhere.slice(
      outlookAlreadySubmittedElsewhere.indexOf('From: Priya Nair'),
    );
    const id = seedInboundEmail(db, {
      id: 'email-detail-inbound',
      fromEmail: FORWARDER,
      toEmail: 'jobinfo@jobs.example',
      subject: ALREADY_SUBMITTED_SUBJECT,
      payload: JSON.stringify({
        FromName: 'Steve Terapak',
        TextBody: `________________________________\n${inbound}`,
      }),
    });
    db.update(inboundEmails).set({ isForwarded: true }).where(eq(inboundEmails.id, id)).run();
    expect(getInboundEmailDetailForUser(db, userId, id)?.forwarded.writtenByYou).toBe(false);
  });
});
