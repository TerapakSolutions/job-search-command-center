/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { applications, inboundEmails, interviews } from '../db/schema.js';
import { upsertInterviewFromEmail } from './emailAutomationService.js';
import { applySafeAutomationRules } from './emailProcessingAutomation.js';
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';

describe('dashboard interview-date backfill — kept in sync independent of pipeline transitions (#13)', () => {
  it('reproduces the real production scenario: update_pipeline already completed, interviewDatetime becomes available on reanalysis -> interviewDate is backfilled', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    // Application already sitting at "interviewing" -- mirrors the real
    // terapak.com row: a status transition already happened in the past, so
    // update_pipeline has nothing new to do and will be skipped on reanalysis.
    const appId = seedApplication(db, userId, {
      company: 'Acme Corp',
      roleTitle: 'Engineer',
      status: 'interviewing',
    });

    const emailId = seedInboundEmail(db, {
      classification: 'Scheduling',
      classificationConfidence: 88,
      companyName: 'Acme Corp',
      positionTitle: 'Engineer',
      interviewDetected: true,
      interviewDatetime: null,
    });

    // First pass: no interviewDatetime yet. update_pipeline runs (status is
    // already 'interviewing' but force:true still records it completed).
    applySafeAutomationRules(db, userId, emailId);
    let app = db.select().from(applications).where(eq(applications.id, appId)).all()[0];
    expect(app.interviewDate).toBeNull();

    // interviewDatetime becomes available (e.g. via the #8 extraction fix
    // re-running on reanalysis).
    db.update(inboundEmails)
      .set({ interviewDatetime: '2026-07-07T18:00:00.000Z' })
      .where(eq(inboundEmails.id, emailId))
      .run();

    // Reanalysis: update_pipeline is skipped (already completed), but #11
    // ensures create_interview still fires independently.
    const result = applySafeAutomationRules(db, userId, emailId, {
      skipCompletedActions: true,
    });
    expect(
      result.results.some((r) => r.actionType === 'create_interview' && r.success),
    ).toBe(true);

    // The actual regression: interviewDate must now be backfilled even
    // though update_pipeline did NOT run on this pass.
    app = db.select().from(applications).where(eq(applications.id, appId)).all()[0];
    expect(app.interviewDate).toBe('2026-07-07');
  });

  it('backfills interviewDate when creating a new interview record directly', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const appId = seedApplication(db, userId, { status: 'recruiter_screen' });
    const emailId = seedInboundEmail(db, {
      classification: 'Scheduling',
      classificationConfidence: 90,
      interviewDatetime: '2026-08-01T15:00:00.000Z',
    });

    const result = upsertInterviewFromEmail(db, userId, emailId, appId);
    expect(result?.success).toBe(true);

    const app = db.select().from(applications).where(eq(applications.id, appId)).all()[0];
    expect(app.interviewDate).toBe('2026-08-01');
  });

  it('backfills interviewDate to the newest value when updating an existing same-day interview record', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const appId = seedApplication(db, userId, { status: 'interviewing' });
    const emailId = seedInboundEmail(db, {
      classification: 'Scheduling',
      classificationConfidence: 90,
      interviewDatetime: '2026-08-01T15:00:00.000Z',
    });

    upsertInterviewFromEmail(db, userId, emailId, appId);

    // A follow-up email retimes the same day's interview.
    db.update(inboundEmails)
      .set({ interviewDatetime: '2026-08-01T19:00:00.000Z' })
      .where(eq(inboundEmails.id, emailId))
      .run();
    const result = upsertInterviewFromEmail(db, userId, emailId, appId);
    expect(result?.changes.updated).toBe(true);

    expect(db.select().from(interviews).all()).toHaveLength(1);
    const app = db.select().from(applications).where(eq(applications.id, appId)).all()[0];
    expect(app.interviewDate).toBe('2026-08-01');
  });
});
