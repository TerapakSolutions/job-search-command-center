/** @jest-environment node */
import {
  classifyEmailContent,
  classifyInboundEmailForUser,
  classifyUnprocessedInboundEmailsForUser,
} from './emailClassificationService.js';
import * as engine from './emailClassificationEngine.js';
import { createTestDb, seedInboundEmail, seedTestUser } from './testDb.js';

jest.mock('./emailClassificationEngine.js', () => ({
  classifyInboundEmailWithLlm: jest.fn(),
  classifyInboundEmailWithRules: jest.requireActual('./emailClassificationEngine.js')
    .classifyInboundEmailWithRules,
}));

const mockLlm = jest.mocked(engine.classifyInboundEmailWithLlm);

describe('classifyEmailContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLlm.mockResolvedValue(null);
  });

  it('falls back to rules when LLM is unavailable', async () => {
    const result = await classifyEmailContent({
      subject: 'Thanks',
      fromEmail: 'jobs@corp.com',
      textBody: 'Thank you for applying.',
    });
    expect(result.classification).toBe('Application Confirmation');
    expect(mockLlm).toHaveBeenCalled();
  });

  it('classifies Thank You for Your Application as Application Confirmation', async () => {
    const result = await classifyEmailContent({
      subject: 'Thank You for Your Application!',
      fromEmail: 'noreply@workday.com',
      textBody: 'Thank you for your application to the Software Engineer role.',
    });
    expect(result.classification).toBe('Application Confirmation');
    expect(result.classification).not.toBe('Recruiter Outreach');
  });

  it('uses LLM result when available', async () => {
    mockLlm.mockResolvedValue({
      classification: 'Offer',
      classificationConfidence: 95,
      companyName: 'BigCo',
      positionTitle: 'Staff Engineer',
      recruiterName: null,
      requiresResponse: true,
      suggestedAction: 'Review offer',
      actionDueAt: null,
      interviewDetected: false,
      interviewDatetime: null,
      aiSummary: 'Offer received.',
    });

    const result = await classifyEmailContent({
      subject: 'Offer',
      fromEmail: 'hr@bigco.com',
      textBody: 'We are pleased to offer you the role.',
    });
    expect(result.classification).toBe('Offer');
  });

  it('overrides LLM Other with rule-based interview confirmation for forwarded Pathstream email', async () => {
    mockLlm.mockResolvedValue({
      classification: 'Other',
      classificationConfidence: 55,
      companyName: 'Workday',
      positionTitle: null,
      recruiterName: null,
      requiresResponse: false,
      suggestedAction: 'Review manually',
      actionDueAt: null,
      interviewDetected: false,
      interviewDatetime: null,
      aiSummary: 'Generic email.',
    });

    const textBody = `---------- Forwarded message ---------
From: John Hardin <jhardin@pathstream.com>
Date: Mon, Jul 1, 2026 at 2:00 PM
Subject: Pathstream | Interview Confirmation for Engineering Manager
To: seeker@example.com

Your interview with Pathstream for the Engineering Manager position is confirmed for July 5, 2026 at 2:00 PM PT.`;

    const result = await classifyEmailContent({
      subject: 'Fwd: Pathstream | Interview Confirmation for Engineering Manager',
      fromEmail: 'steve@terapak.com',
      textBody,
    });

    expect(result.classification).toBe('Scheduling');
    expect(result.classification).not.toBe('Other');
    expect(result.companyName).toBe('Pathstream');
    expect(result.positionTitle).toBe('Engineering Manager');
    expect(result.recruiterName).toBe('John Hardin');
    expect(result.interviewDetected).toBe(true);
    expect(result.interviewDatetime).toMatch(/^2026-07-05/);
  });

  it('falls back to rules when LLM throws', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockLlm.mockRejectedValue(new Error('LLM down'));
    const result = await classifyEmailContent({
      subject: 'Update',
      fromEmail: 'hr@startup.io',
      textBody: 'We decided to move forward with other candidates.',
    });
    expect(result.classification).toBe('Rejection');
    errorSpy.mockRestore();
  });
});

describe('classifyInboundEmailForUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLlm.mockResolvedValue(null);
  });

  it('stores classification fields on the email row', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const emailId = seedInboundEmail(db, {
      id: 'email-classify',
      toEmail: 'seeker@example.com',
      subject: 'Interview',
      payload: JSON.stringify({
        TextBody: 'We reviewed your resume and want to schedule an interview.',
      }),
    });

    const result = await classifyInboundEmailForUser(db, userId, emailId);
    expect(result?.classification).toBe('Interview Request');
    expect(result?.processedAt).toBeTruthy();
    expect(result?.suggestedAction).toContain('schedule');
  });

  it('returns existing classification without force', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const emailId = seedInboundEmail(db, {
      id: 'email-cached',
      toEmail: 'seeker@example.com',
      processedAt: '2026-07-01T10:00:00.000Z',
      classification: 'Other',
      classificationConfidence: 50,
      suggestedAction: 'Review manually',
      requiresResponse: false,
      aiSummary: 'Cached summary',
    });

    const result = await classifyInboundEmailForUser(db, userId, emailId);
    expect(result?.classification).toBe('Other');
    expect(mockLlm).not.toHaveBeenCalled();
  });

  it('re-classifies with force', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const emailId = seedInboundEmail(db, {
      id: 'email-force',
      toEmail: 'seeker@example.com',
      processedAt: '2026-07-01T10:00:00.000Z',
      classification: 'Other',
      payload: JSON.stringify({
        TextBody: 'Thank you for applying to our team.',
      }),
    });

    const result = await classifyInboundEmailForUser(db, userId, emailId, {
      force: true,
    });
    expect(result?.classification).toBe('Application Confirmation');
  });
});

describe('classifyUnprocessedInboundEmailsForUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLlm.mockResolvedValue(null);
  });

  it('classifies only unprocessed emails for the user', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    seedInboundEmail(db, {
      id: 'email-a',
      toEmail: 'seeker@example.com',
      payload: JSON.stringify({ TextBody: 'Thank you for applying.' }),
    });
    seedInboundEmail(db, {
      id: 'email-b',
      toEmail: 'seeker@example.com',
      processedAt: '2026-07-01T09:00:00.000Z',
      classification: 'Other',
      payload: JSON.stringify({ TextBody: 'Already done' }),
    });
    seedInboundEmail(db, {
      id: 'email-other-user',
      toEmail: 'other@example.com',
      payload: JSON.stringify({ TextBody: 'Thank you for applying.' }),
    });

    const result = await classifyUnprocessedInboundEmailsForUser(db, userId);
    expect(result).toEqual({ classified: 1, failed: 0, skipped: 0 });
  });
});
