/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { applications, contacts } from '../db/schema.js';
import {
  analyzeEmailAutomation,
} from './emailAutomationService.js';
import { applySafeAutomationRules } from './emailProcessingAutomation.js';
import { createId, nowIso } from './id.js';
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';

/**
 * End-to-end verification of the downstream behavior for issue #14's fix,
 * using the real production shape (Pathstream email, unrelated terapak.com
 * junk application with a contact whose email happens to match the sender).
 *
 * Confirms what actually happens once the matcher no longer bypasses
 * MATCH_CONFIDENCE_THRESHOLD for a single candidate: NOT automatic
 * application creation (Scheduling has no auto-create-application fallback
 * in applySafeAutomationRules -- that path exists only for Recruiter
 * Outreach), but the email correctly stops misattaching to the junk
 * application, and a manual "Create application" next action is surfaced.
 */
describe('matcher confidence-threshold fix — real downstream behavior (issue #14)', () => {
  it('no longer misattaches; surfaces a manual create_application next action instead of auto-creating', () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const junkAppId = seedApplication(db, userId, {
      id: 'app-terapak',
      company: 'terapak.com',
      roleTitle: 'Unknown role',
      status: 'interviewing',
    });

    const ts = nowIso();
    db.insert(contacts)
      .values({
        id: createId(),
        userId,
        applicationId: junkAppId,
        name: 'Jon Hardin',
        email: 'jhardin@pathstream.com',
        linkedIn: '',
        messageNotes: '',
        nextAction: '',
        createdAt: ts,
        updatedAt: ts,
      })
      .run();

    const emailId = seedInboundEmail(db, {
      fromEmail: 'jhardin@pathstream.com',
      classification: 'Scheduling',
      classificationConfidence: 88,
      companyName: 'Pathstream',
      positionTitle: 'Engineering Manager',
      recruiterName: 'Jon Hardin',
      interviewDetected: true,
      interviewDatetime: '2026-07-07T18:00:00.000Z',
    });

    const analysis = analyzeEmailAutomation(db, userId, emailId);
    expect(analysis).not.toBeNull();
    // No longer confidently matched to the unrelated junk application.
    expect(analysis?.matches.bestMatch).toBeNull();
    // But company/role were clearly identified, so it's flagged as
    // creatable...
    expect(analysis?.canCreateApplication).toBe(true);
    // ...and surfaced as a manual next action for the user.
    expect(
      analysis?.nextActions.some((a) => a.type === 'create_application'),
    ).toBe(true);

    // The automated pipeline itself takes NO action: Scheduling has no
    // auto-create-application fallback (only Recruiter Outreach does), and
    // every Scheduling/interview branch requires an already-resolved
    // applicationId, which is now correctly absent.
    const result = applySafeAutomationRules(db, userId, emailId);
    expect(result.results).toHaveLength(0);

    // The junk application is untouched -- no more silent misattachment.
    const junkApp = db
      .select()
      .from(applications)
      .where(eq(applications.id, junkAppId))
      .all()[0];
    expect(junkApp.status).toBe('interviewing');
    expect(junkApp.interviewDate).toBeNull();
  });
});
