/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { inboundEmails, interviews } from '../db/schema.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';

// Mirror the Pathstream regression's deterministic setup: force the rule-based
// classifier (LLM off) so the outcome is stable.
jest.mock('./emailClassificationEngine.js', () => {
  const actual = jest.requireActual(
    './emailClassificationEngine.js',
  ) as typeof import('./emailClassificationEngine.js');
  return {
    classifyInboundEmailWithLlm: jest.fn().mockResolvedValue(null),
    classifyInboundEmailWithRules: actual.classifyInboundEmailWithRules,
  };
});

const FORWARDED_BODY = `---------- Forwarded message ---------
From: John Hardin <jhardin@pathstream.com>
Date: Mon, Jul 1, 2026 at 2:00 PM
Subject: Pathstream | Interview Confirmation for Engineering Manager
To: seeker@example.com

Hi,

Your interview with Pathstream for the Engineering Manager position is confirmed for July 5, 2026 at 2:00 PM PT.

Thanks,
John`;

describe('reanalyzing a stale pre-fix email (verification for AC#3)', () => {
  it('reclassifies a stored "Other" interview email to Scheduling and creates the interview record', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const appId = seedApplication(db, userId, {
      id: 'app-pathstream-em',
      company: 'Pathstream',
      roleTitle: 'Engineering Manager',
      status: 'recruiter_screen',
    });

    // Seed the email in the STALE state it would hold from pre-fix processing:
    // classified "Other", already marked processed, no interview detected.
    const emailId = seedInboundEmail(db, {
      id: 'email-stale-pathstream',
      toEmail: 'seeker@example.com',
      fromEmail: 'steve@terapak.com',
      subject: 'Fw: Pathstream | Interview Confirmation for Engineering Manager',
      payload: JSON.stringify({ TextBody: FORWARDED_BODY }),
      receivedAt: '2026-07-02T15:52:00.000Z',
      classification: 'Other',
      classificationConfidence: 40,
      interviewDetected: false,
      processedAt: '2026-07-02T15:53:00.000Z',
    });
    db.update(inboundEmails)
      .set({ processingStatus: 'processed', lastProcessedAt: '2026-07-02T15:53:00.000Z' })
      .where(eq(inboundEmails.id, emailId))
      .run();

    // Baseline: stale state, no interview record yet.
    expect(db.select().from(interviews).all()).toHaveLength(0);

    // The manual reanalyze path (reanalysis + manual) re-runs classification.
    const result = await processInboundEmail(db, emailId, {
      userId,
      reanalysis: true,
      manual: true,
    });
    expect(result.processingStatus).toBe('processed');

    const row = db.select().from(inboundEmails).where(eq(inboundEmails.id, emailId)).all()[0];
    expect(row.classification).toBe('Scheduling');
    expect(row.interviewDetected).toBe(true);
    expect(row.interviewDatetime).toMatch(/^2026-07-05/);

    const interviewRows = db.select().from(interviews).all();
    expect(interviewRows).toHaveLength(1);
    expect(interviewRows[0].applicationId).toBe(appId);
    expect(interviewRows[0].scheduledAt).toMatch(/^2026-07-05/);
  });
});
