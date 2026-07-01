/** @jest-environment node */
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';
import { applySafeAutomationRules, collectRiskyApprovalReasons } from './emailProcessingAutomation.js';
import {
  analyzeEmailAutomation,
  listAuditLogForUser,
} from './emailAutomationService.js';
import {
  processInboundEmail,
} from './inboundEmailProcessingService.js';
import {
  resetInboundEmailProcessingScheduler,
  scheduleInboundEmailProcessing,
  setInboundEmailProcessingScheduler,
} from './inboundEmailProcessingQueue.js';
import { resolveUserIdForInboundEmail } from './inboundEmailUserResolver.js';
import { inboundEmails, applications } from '../db/schema.js';
import { eq } from 'drizzle-orm';

jest.mock('./emailClassificationEngine.js', () => ({
  classifyInboundEmailWithLlm: jest.fn().mockResolvedValue(null),
  classifyInboundEmailWithRules: jest.fn().mockImplementation(async (input: {
    subject: string;
    fromEmail: string;
    textBody: string;
  }) => {
    if (input.subject.toLowerCase().includes('rejection')) {
      return {
        classification: 'Rejection',
        classificationConfidence: 90,
        companyName: 'Acme Corp',
        positionTitle: 'Engineer',
        recruiterName: 'Sam',
        requiresResponse: false,
        suggestedAction: 'Archive rejection',
        actionDueAt: null,
        interviewDetected: false,
        interviewDatetime: null,
        aiSummary: 'Application rejected',
      };
    }
    if (input.fromEmail.includes('linkedin')) {
      return {
        classification: 'Application Confirmation',
        classificationConfidence: 85,
        companyName: 'LinkedCo',
        positionTitle: 'Engineer',
        recruiterName: null,
        requiresResponse: false,
        suggestedAction: 'Track application',
        actionDueAt: null,
        interviewDetected: false,
        interviewDatetime: null,
        aiSummary: 'LinkedIn application received',
      };
    }
    return {
      classification: 'Recruiter Outreach',
      classificationConfidence: 80,
      companyName: 'NewCo',
      positionTitle: 'Backend Engineer',
      recruiterName: 'Alex',
      requiresResponse: true,
      suggestedAction: 'Reply to recruiter',
      actionDueAt: null,
      interviewDetected: false,
      interviewDatetime: null,
      aiSummary: 'Recruiter outreach',
    };
  }),
}));

describe('inboundEmailProcessingService', () => {
  afterEach(() => {
    resetInboundEmailProcessingScheduler();
  });

  it('resolves user from recipient email', () => {
    const db = createTestDb();
    seedTestUser(db, { email: 'seeker@example.com' });
    const emailId = seedInboundEmail(db, { toEmail: 'seeker@example.com' });
    const row = db.select().from(inboundEmails).where(eq(inboundEmails.id, emailId)).all()[0];
    expect(resolveUserIdForInboundEmail(db, row)).toBe('user-test-1');
  });

  it('processes email successfully with classification and audit log', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const emailId = seedInboundEmail(db, {
      id: 'email-process',
      toEmail: 'seeker@example.com',
      subject: 'Recruiter hello',
      fromEmail: 'recruiter@newco.com',
    });

    const result = await processInboundEmail(db, emailId);
    expect(result.processingStatus).toBe('processed');
    expect(result.classificationRan).toBe(true);

    const row = db.select().from(inboundEmails).where(eq(inboundEmails.id, emailId)).all()[0];
    expect(row.processingStatus).toBe('processed');
    expect(row.classification).toBe('Recruiter Outreach');
    expect(row.processedAt).toBeTruthy();

    const audit = listAuditLogForUser(db, userId);
    expect(audit.some((a) => a.actionType === 'auto_process')).toBe(true);
  });

  it('marks email failed when no user can be resolved', async () => {
    const db = createTestDb();
    const emailId = seedInboundEmail(db, {
      toEmail: 'unknown@example.com',
      fromEmail: 'sender@example.com',
    });

    const result = await processInboundEmail(db, emailId);
    expect(result.processingStatus).toBe('failed');
    expect(result.processingError).toMatch(/No matching user/i);

    const row = db.select().from(inboundEmails).where(eq(inboundEmails.id, emailId)).all()[0];
    expect(row.processingStatus).toBe('failed');
    expect(row.processingError).toMatch(/No matching user/i);
  });

  it('skips duplicate automation actions on re-analysis', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    seedApplication(db, userId, {
      id: 'app-reject',
      company: 'Acme Corp',
      roleTitle: 'Engineer',
      status: 'applied',
    });
    const emailId = seedInboundEmail(db, {
      id: 'email-reject',
      toEmail: 'seeker@example.com',
      fromEmail: 'hr@acme.com',
      subject: 'Rejection notice',
      classification: 'Rejection',
      classificationConfidence: 90,
      companyName: 'Acme Corp',
      positionTitle: 'Engineer',
      processedAt: '2026-07-01T10:00:00.000Z',
      processingStatus: 'processed',
    });

    await processInboundEmail(db, emailId, {
      userId,
      reanalysis: true,
      manual: true,
    });

    const audit = listAuditLogForUser(db, userId);
    const pipelineUpdates = audit.filter((a) => a.actionType === 'update_pipeline');
    const completedUpdates = pipelineUpdates.filter((a) => a.status === 'completed');
    expect(completedUpdates.length).toBeLessThanOrEqual(1);
    expect(audit.some((a) => a.actionType === 'reanalyze')).toBe(true);
  });

  it('schedules background processing without blocking', () => {
    const db = createTestDb();
    seedTestUser(db, { email: 'seeker@example.com' });
    const scheduled: string[] = [];
    setInboundEmailProcessingScheduler((_db, emailId) => {
      scheduled.push(emailId);
    });

    scheduleInboundEmailProcessing(db, 'email-bg');
    expect(scheduled).toEqual(['email-bg']);
  });
});

describe('emailProcessingAutomation safe rules', () => {
  it('auto-applies high-confidence rejection pipeline update', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const appId = seedApplication(db, userId, {
      id: 'app-safe-reject',
      company: 'Acme Corp',
      roleTitle: 'Engineer',
      status: 'applied',
    });
    const emailId = seedInboundEmail(db, {
      id: 'email-safe-reject',
      fromEmail: 'hr@acme.com',
      classification: 'Rejection',
      classificationConfidence: 90,
      companyName: 'Acme Corp',
      positionTitle: 'Engineer',
      processedAt: '2026-07-01T10:00:00.000Z',
    });

    const { results } = applySafeAutomationRules(db, userId, emailId);
    expect(results.some((r) => r.actionType === 'update_pipeline' && r.success)).toBe(
      true,
    );

    const app = db
      .select()
      .from(applications)
      .where(eq(applications.id, appId))
      .all()[0];
    expect(app.status).toBe('rejected');
  });

  it('queues risky interview scheduling for approval', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId, {
      id: 'app-interview',
      company: 'Acme Corp',
      roleTitle: 'Engineer',
      status: 'applied',
    });
    const emailId = seedInboundEmail(db, {
      id: 'email-interview',
      fromEmail: 'hr@acme.com',
      classification: 'Interview Request',
      classificationConfidence: 90,
      companyName: 'Acme Corp',
      positionTitle: 'Engineer',
      interviewDetected: true,
      processedAt: '2026-07-01T10:00:00.000Z',
    });

    const analysis = analyzeEmailAutomation(db, userId, emailId)!;
    const reasons = collectRiskyApprovalReasons(
      db.select().from(inboundEmails).where(eq(inboundEmails.id, emailId)).all()[0],
      analysis,
    );
    expect(reasons).toContain('interview_scheduling');

    const { pendingApprovals } = applySafeAutomationRules(db, userId, emailId);
    expect(pendingApprovals).toBeGreaterThan(0);
  });

  it('creates LinkedIn application on safe auto rule', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const emailId = seedInboundEmail(db, {
      id: 'email-linkedin',
      fromEmail: 'jobs-noreply@linkedin.com',
      classification: 'Application Confirmation',
      classificationConfidence: 85,
      companyName: 'LinkedCo',
      positionTitle: 'Engineer',
      processedAt: '2026-07-01T10:00:00.000Z',
    });

    const { results } = applySafeAutomationRules(db, userId, emailId);
    expect(results.some((r) => r.actionType === 'create_application' && r.success)).toBe(
      true,
    );
  });
});
