/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { applications, interviews } from '../db/schema.js';
import { applySafeAutomationRules } from './emailProcessingAutomation.js';
import {
  createTestDb,
  seedApplication,
  seedInboundEmail,
  seedTestUser,
} from './testDb.js';

type Db = ReturnType<typeof createTestDb>;

const CONCRETE_DATETIME = '2026-07-05T21:00:00.000Z';

/**
 * Seed an Interview Request inbound email that (by default) confidently matches
 * the single seeded Acme Corp / Engineer application. Individual tests override
 * confidence and interviewDatetime to exercise the two automation gates.
 */
function seedInterviewRequest(
  db: Db,
  overrides: Partial<Parameters<typeof seedInboundEmail>[1]> = {},
): string {
  return seedInboundEmail(db, {
    id: 'email-interview-request',
    toEmail: 'seeker@example.com',
    fromEmail: 'recruiter@acme.com',
    subject: 'Interview for the Engineer role',
    classification: 'Interview Request',
    classificationConfidence: 90,
    companyName: 'Acme Corp',
    positionTitle: 'Engineer',
    recruiterName: 'Jane Recruiter',
    interviewDetected: true,
    interviewDatetime: CONCRETE_DATETIME,
    processedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  });
}

describe('Interview Request → interview record automation (Option C)', () => {
  it('creates an interview record when it has a concrete date/time and a high-confidence match', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const appId = seedApplication(db, userId, { status: 'applied' });

    const emailId = seedInterviewRequest(db);
    const { results, pendingApprovals } = applySafeAutomationRules(db, userId, emailId);

    const interviewRows = db.select().from(interviews).all();
    expect(interviewRows).toHaveLength(1);
    expect(interviewRows[0].applicationId).toBe(appId);
    expect(interviewRows[0].scheduledAt).toMatch(/^2026-07-05/);
    expect(results.some((r) => r.actionType === 'create_interview' && r.success)).toBe(
      true,
    );

    // Scope guard: only the interview RECORD is auto-created. The pipeline status
    // change for an Interview Request stays human-gated (routed to approval), so
    // the application is not silently advanced.
    const app = db.select().from(applications).where(eq(applications.id, appId)).all()[0];
    expect(app.status).toBe('applied');
    expect(pendingApprovals).toBeGreaterThanOrEqual(1);
  });

  it('does not auto-create on low confidence; routes to pending approval instead', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId, { status: 'applied' });

    const emailId = seedInterviewRequest(db, { classificationConfidence: 60 });
    const { pendingApprovals } = applySafeAutomationRules(db, userId, emailId);

    expect(db.select().from(interviews).all()).toHaveLength(0);
    expect(pendingApprovals).toBeGreaterThanOrEqual(1);
  });

  it('never creates an interview record without a concrete date/time, even at high confidence', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId, { status: 'applied' });

    const emailId = seedInterviewRequest(db, { interviewDatetime: null });
    const { pendingApprovals } = applySafeAutomationRules(db, userId, emailId);

    expect(db.select().from(interviews).all()).toHaveLength(0);
    // Not silently dropped — the tentative request still surfaces for the user.
    expect(pendingApprovals).toBeGreaterThanOrEqual(1);
  });

  it('does not auto-create on an ambiguous application match; routes to pending approval', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    // Two indistinguishable applications → matcher flags requiresManualSelection.
    seedApplication(db, userId, { id: 'app-a', status: 'applied' });
    seedApplication(db, userId, { id: 'app-b', status: 'applied' });

    const emailId = seedInterviewRequest(db);
    const { pendingApprovals } = applySafeAutomationRules(db, userId, emailId);

    expect(db.select().from(interviews).all()).toHaveLength(0);
    expect(pendingApprovals).toBeGreaterThanOrEqual(1);
  });

  it('reprocessing the same Interview Request email does not duplicate the record', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId, { status: 'applied' });

    const emailId = seedInterviewRequest(db);
    applySafeAutomationRules(db, userId, emailId);
    applySafeAutomationRules(db, userId, emailId);

    expect(db.select().from(interviews).all()).toHaveLength(1);
  });

  it('an Interview Request then a later Scheduling email for the same interview yields one updated record', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const appId = seedApplication(db, userId, { status: 'applied' });

    // Interview Request with a concrete proposed time → creates the record.
    const requestId = seedInterviewRequest(db, { id: 'email-req' });
    applySafeAutomationRules(db, userId, requestId);

    // Later formal Scheduling confirmation for the same day → updates, not duplicates.
    const schedulingId = seedInboundEmail(db, {
      id: 'email-sched',
      toEmail: 'seeker@example.com',
      fromEmail: 'recruiter@acme.com',
      subject: 'Interview confirmed for the Engineer role',
      classification: 'Scheduling',
      classificationConfidence: 90,
      companyName: 'Acme Corp',
      positionTitle: 'Engineer',
      recruiterName: 'Jane Recruiter',
      interviewDetected: true,
      interviewDatetime: '2026-07-05T23:30:00.000Z',
      processedAt: '2026-07-02T10:00:00.000Z',
    });
    applySafeAutomationRules(db, userId, schedulingId);

    const interviewRows = db
      .select()
      .from(interviews)
      .where(eq(interviews.applicationId, appId))
      .all();
    expect(interviewRows).toHaveLength(1);
    expect(interviewRows[0].scheduledAt).toBe('2026-07-05T23:30:00.000Z');
  });

  it('leaves Scheduling behavior intact: Scheduling + concrete date/time still creates the record', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const appId = seedApplication(db, userId, { status: 'applied' });

    const emailId = seedInboundEmail(db, {
      id: 'email-scheduling-parity',
      toEmail: 'seeker@example.com',
      fromEmail: 'recruiter@acme.com',
      subject: 'Interview confirmed for the Engineer role',
      classification: 'Scheduling',
      classificationConfidence: 90,
      companyName: 'Acme Corp',
      positionTitle: 'Engineer',
      recruiterName: 'Jane Recruiter',
      interviewDetected: true,
      interviewDatetime: CONCRETE_DATETIME,
      processedAt: '2026-07-01T10:00:00.000Z',
    });
    applySafeAutomationRules(db, userId, emailId);

    const interviewRows = db.select().from(interviews).all();
    expect(interviewRows).toHaveLength(1);
    expect(interviewRows[0].applicationId).toBe(appId);
    // Scheduling still also auto-advances the pipeline (unchanged behavior).
    const app = db.select().from(applications).where(eq(applications.id, appId)).all()[0];
    expect(app.status).toBe('interviewing');
  });
});
