/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { emailAutomationAuditLog, inboundEmails, interviews } from '../db/schema.js';
import { applySafeAutomationRules } from './emailProcessingAutomation.js';
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';

describe('reanalysis idempotency — create_interview is not blocked by update_pipeline (#11)', () => {
  it('creates the interview on reanalysis once interviewDatetime becomes available, even though update_pipeline already completed on the original run', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const appId = seedApplication(db, userId, {
      company: 'Acme Corp',
      roleTitle: 'Engineer',
      status: 'applied',
    });

    // Original run: Scheduling email with NO interviewDatetime yet (the
    // pre-extraction-fix state). update_pipeline succeeds and is marked
    // completed; create_interview is a no-op because there's no datetime.
    const emailId = seedInboundEmail(db, {
      classification: 'Scheduling',
      classificationConfidence: 88,
      companyName: 'Acme Corp',
      positionTitle: 'Engineer',
      interviewDetected: true,
      interviewDatetime: null,
    });

    const firstPass = applySafeAutomationRules(db, userId, emailId);
    expect(
      firstPass.results.some((r) => r.actionType === 'update_pipeline' && r.success),
    ).toBe(true);
    expect(firstPass.results.some((r) => r.actionType === 'create_interview')).toBe(
      false,
    );
    expect(db.select().from(interviews).all()).toHaveLength(0);

    const completedPipelineAudits = () =>
      db
        .select()
        .from(emailAutomationAuditLog)
        .where(eq(emailAutomationAuditLog.inboundEmailId, emailId))
        .all()
        .filter((row) => row.actionType === 'update_pipeline' && row.status === 'completed');
    expect(completedPipelineAudits()).toHaveLength(1);

    // interviewDatetime becomes available (e.g. a classification/extraction
    // fix re-ran and populated it) -- simulate that directly on the row, as a
    // reanalysis would.
    db.update(inboundEmails)
      .set({ interviewDatetime: '2026-07-07T18:00:00.000Z' })
      .where(eq(inboundEmails.id, emailId))
      .run();

    // Reanalysis pass: skipCompletedActions is true (mirrors
    // processInboundEmail's reanalysis path). Before the fix, update_pipeline
    // being already-completed short-circuited the WHOLE Scheduling block,
    // so create_interview was never even attempted.
    const secondPass = applySafeAutomationRules(db, userId, emailId, {
      skipCompletedActions: true,
    });

    expect(
      secondPass.results.some((r) => r.actionType === 'create_interview' && r.success),
    ).toBe(true);

    const interviewRows = db.select().from(interviews).all();
    expect(interviewRows).toHaveLength(1);
    expect(interviewRows[0].applicationId).toBe(appId);
    expect(interviewRows[0].scheduledAt).toBe('2026-07-07T18:00:00.000Z');

    // update_pipeline must NOT have been re-executed: still exactly one
    // completed audit entry, and no new pipeline-update result on this pass.
    expect(completedPipelineAudits()).toHaveLength(1);
    expect(
      secondPass.results.some((r) => r.actionType === 'update_pipeline'),
    ).toBe(false);
  });

  it('first-time (non-reanalysis) processing still creates pipeline update and interview together, unchanged', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const appId = seedApplication(db, userId, {
      company: 'Acme Corp',
      roleTitle: 'Engineer',
      status: 'applied',
    });
    const emailId = seedInboundEmail(db, {
      classification: 'Scheduling',
      classificationConfidence: 88,
      companyName: 'Acme Corp',
      positionTitle: 'Engineer',
      interviewDetected: true,
      interviewDatetime: '2026-07-07T18:00:00.000Z',
    });

    // No skipCompletedActions -- the ordinary first-pass path.
    const result = applySafeAutomationRules(db, userId, emailId);

    expect(
      result.results.some((r) => r.actionType === 'update_pipeline' && r.success),
    ).toBe(true);
    expect(
      result.results.some((r) => r.actionType === 'create_interview' && r.success),
    ).toBe(true);

    const interviewRows = db.select().from(interviews).all();
    expect(interviewRows).toHaveLength(1);
    expect(interviewRows[0].applicationId).toBe(appId);
  });
});
