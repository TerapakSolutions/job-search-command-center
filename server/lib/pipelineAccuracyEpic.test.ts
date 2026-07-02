/** @jest-environment node */
import { createTestDb, seedInboundEmail, seedTestUser } from './testDb.js';
import { applySafeAutomationRules } from './emailProcessingAutomation.js';
import {
  createApplicationFromEmail,
  listPendingApprovalsForUser,
} from './emailAutomationService.js';
import { getActivityMetrics } from './activityMetrics.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import { ProcessingTimelineBuilder } from './processingTimeline.js';
import { isNoReplyOrApplicationConfirmation } from './emailAutomationMessages.js';
import { inboundEmails, applications } from '../db/schema.js';
import { eq } from 'drizzle-orm';

jest.mock('./emailClassificationEngine.js', () => ({
  classifyInboundEmailWithLlm: jest.fn().mockResolvedValue(null),
  classifyInboundEmailWithRules: jest.fn().mockImplementation((input: {
    subject: string;
    fromEmail: string;
    textBody: string;
  }) => ({
    classification: input.textBody.toLowerCase().includes('thank you for your application')
      ? 'Application Confirmation'
      : 'Recruiter Outreach',
    classificationConfidence: 90,
    companyName: 'PwC',
    positionTitle: 'Engineer',
    recruiterName: null,
    requiresResponse: false,
    suggestedAction: 'No action needed — application received',
    actionDueAt: null,
    interviewDetected: false,
    interviewDatetime: null,
    aiSummary: 'Application confirmation',
  })),
}));

describe('pipeline accuracy epic', () => {
  it('suppresses reply approval for no-reply application confirmations', () => {
    expect(
      isNoReplyOrApplicationConfirmation({
        fromEmail: 'noreply@myworkday.com',
        classification: 'Application Confirmation',
        subject: 'Thank you',
        textBody: 'Thank you for your application',
      }),
    ).toBe(true);
  });

  it('creates application from forwarded confirmation and updates metrics', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const emailId = seedInboundEmail(db, {
      id: 'email-forward-app',
      toEmail: 'seeker@example.com',
      fromEmail: 'steve@terapak.com',
      subject: 'Fwd: Thank you for your application',
      payload: JSON.stringify({
        TextBody: `---------- Forwarded message ---------
From: Workday <noreply@myworkday.com>
Subject: Thank you for your application
To: steve@terapak.com

Thank you for your application to PwC.`,
      }),
      receivedAt: '2026-07-01T12:00:00.000Z',
    });

    const result = await processInboundEmail(db, emailId, { userId, manual: true });
    expect(result.processingStatus).toBe('processed');

    const row = db
      .select()
      .from(inboundEmails)
      .where(eq(inboundEmails.id, emailId))
      .all()[0];
    expect(row.isForwarded).toBe(true);
    expect(row.originalSenderEmail).toBe('noreply@myworkday.com');
    expect(row.classification).toBe('Application Confirmation');

    const apps = db.select().from(applications).all();
    expect(apps.length).toBe(1);
    expect(apps[0].dateApplied).toBe('2026-07-01');

    const metrics = getActivityMetrics(db, userId, new Date('2026-07-01T18:00:00.000Z'));
    expect(metrics.applicationsToday).toBe(1);

    const timeline = ProcessingTimelineBuilder.parse(row.processingTimelineJson);
    expect(timeline?.steps.some((s) => s.step === 'classified' && s.status === 'completed')).toBe(
      true,
    );
    expect(
      timeline?.steps.some(
        (s) => s.step === 'processing_completed' && s.status === 'completed',
      ),
    ).toBe(true);
  });

  it('records processing timeline failure when user cannot be resolved', async () => {
    const db = createTestDb();
    const emailId = seedInboundEmail(db, {
      id: 'email-fail-user',
      toEmail: 'unknown@example.com',
      fromEmail: 'sender@example.com',
    });

    await processInboundEmail(db, emailId);

    const row = db
      .select()
      .from(inboundEmails)
      .where(eq(inboundEmails.id, emailId))
      .all()[0];
    const timeline = ProcessingTimelineBuilder.parse(row.processingTimelineJson);
    expect(
      timeline?.steps.some((s) => s.step === 'processing_failed' && s.status === 'failed'),
    ).toBe(true);
  });

  it('returns duplicate skip message from createApplicationFromEmail', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedInboundEmail(db, {
      id: 'email-dup',
      classification: 'Application Confirmation',
      classificationConfidence: 90,
      companyName: 'Acme Corp',
      positionTitle: 'Engineer',
      processedAt: '2026-07-01T10:00:00.000Z',
    });
    db.insert(applications)
      .values({
        id: 'app-dup',
        userId,
        company: 'Acme Corp',
        roleTitle: 'Engineer',
        jobUrl: '',
        workLocationType: 'remote',
        location: '',
        salaryMin: null,
        salaryMax: null,
        dateApplied: '2026-06-01',
        status: 'applied',
        notes: '',
        interviewDate: null,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      })
      .run();

    const result = createApplicationFromEmail(db, userId, 'email-dup');
    expect(result?.message).toMatch(/Duplicate skipped/i);
  });

  it('includes automation skip reasons in safe rules result', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const emailId = seedInboundEmail(db, {
      id: 'email-skip-reply',
      fromEmail: 'noreply@workday.com',
      classification: 'Application Confirmation',
      classificationConfidence: 90,
      companyName: 'PwC',
      positionTitle: 'Engineer',
      requiresResponse: true,
      suggestedAction: 'No action needed — application received',
      processedAt: '2026-07-01T10:00:00.000Z',
      payload: JSON.stringify({
        TextBody: 'Thank you for your application',
      }),
    });

    const { skipSummary, results } = applySafeAutomationRules(db, userId, emailId);
    expect(skipSummary).toMatch(/Automation skipped: no-reply\/application confirmation/i);
    expect(results.some((r) => r.actionType === 'create_application' && r.success)).toBe(true);
  });

  it('queues approval instead of creating junk application when company/role missing', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const emailId = seedInboundEmail(db, {
      id: 'email-unidentified',
      fromEmail: 'steve@terapak.com',
      classification: 'Application Confirmation',
      classificationConfidence: 90,
      companyName: 'terapak.com',
      positionTitle: 'Unknown role',
      suggestedAction: 'No action needed — application received',
      processedAt: '2026-07-01T10:00:00.000Z',
      payload: JSON.stringify({
        TextBody: 'Thank you for your application',
      }),
    });

    const { results, pendingApprovals } = applySafeAutomationRules(db, userId, emailId);
    expect(results.some((r) => r.actionType === 'create_application' && r.success)).toBe(
      false,
    );
    expect(pendingApprovals).toBeGreaterThan(0);
    expect(db.select().from(applications).all()).toHaveLength(0);

    const pending = listPendingApprovalsForUser(db, userId);
    expect(
      pending.some(
        (p) =>
          p.approvalType === 'no_matching_application' &&
          p.stopReason.includes('insufficient company role extraction'),
      ),
    ).toBe(true);
  });

  it('skips duplicate application creation for repeated confirmations', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    db.insert(applications)
      .values({
        id: 'app-existing-pwc',
        userId,
        company: 'PwC',
        roleTitle: 'Engineer',
        jobUrl: '',
        workLocationType: 'remote',
        location: '',
        salaryMin: null,
        salaryMax: null,
        dateApplied: '2026-07-01',
        status: 'applied',
        notes: '',
        interviewDate: null,
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
      })
      .run();

    const emailId = seedInboundEmail(db, {
      id: 'email-dup-confirm',
      fromEmail: 'noreply@myworkday.com',
      classification: 'Application Confirmation',
      classificationConfidence: 90,
      companyName: 'PwC',
      positionTitle: 'Engineer',
      suggestedAction: 'No action needed — application received',
      processedAt: '2026-07-01T12:00:00.000Z',
      payload: JSON.stringify({
        TextBody: 'Thank you for your application to PwC',
      }),
    });

    const { results } = applySafeAutomationRules(db, userId, emailId);
    expect(results.some((r) => r.actionType === 'create_application' && r.success)).toBe(
      false,
    );
    expect(db.select().from(applications).all()).toHaveLength(1);
  });
});
