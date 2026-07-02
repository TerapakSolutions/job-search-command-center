/** @jest-environment node */
import { eq } from 'drizzle-orm';
import {
  applications,
  communications,
  contacts,
  inboundEmails,
} from '../db/schema.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import {
  createTestDb,
  seedApplication,
  seedInboundEmail,
  seedTestUser,
} from './testDb.js';

jest.mock('./emailClassificationEngine.js', () => {
  const actual = jest.requireActual('./emailClassificationEngine.js') as typeof import('./emailClassificationEngine.js');
  return {
    classifyInboundEmailWithLlm: jest.fn().mockResolvedValue(null),
    classifyInboundEmailWithRules: actual.classifyInboundEmailWithRules,
  };
});

const PATHSTREAM_FORWARDED_BODY = `---------- Forwarded message ---------
From: John Hardin <jhardin@pathstream.com>
Date: Mon, Jul 1, 2026 at 2:00 PM
Subject: Pathstream | Interview Confirmation for Engineering Manager
To: seeker@example.com

Hi,

Your interview with Pathstream for the Engineering Manager position is confirmed for July 5, 2026 at 2:00 PM PT.

Thanks,
John`;

describe('Pathstream interview confirmation email', () => {
  it('classifies, matches, automates, and records activity for forwarded confirmation', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const appId = seedApplication(db, userId, {
      id: 'app-pathstream-em',
      company: 'Pathstream',
      roleTitle: 'Engineering Manager',
      status: 'recruiter_screen',
      dateApplied: '2026-06-15',
    });

    const emailId = seedInboundEmail(db, {
      id: 'email-pathstream-interview',
      toEmail: 'seeker@example.com',
      fromEmail: 'steve@terapak.com',
      subject: 'Fwd: Pathstream | Interview Confirmation for Engineering Manager',
      payload: JSON.stringify({
        TextBody: PATHSTREAM_FORWARDED_BODY,
      }),
      receivedAt: '2026-07-01T12:00:00.000Z',
    });

    const result = await processInboundEmail(db, emailId, { userId, manual: true });
    expect(result.processingStatus).toBe('processed');
    expect(result.classificationRan).toBe(true);
    expect(result.automationActions).toBeGreaterThan(0);

    const row = db
      .select()
      .from(inboundEmails)
      .where(eq(inboundEmails.id, emailId))
      .all()[0];

    expect(row.isForwarded).toBe(true);
    expect(row.originalSenderEmail).toBe('jhardin@pathstream.com');
    expect(row.originalSenderName).toBe('John Hardin');
    expect(row.originalSubject).toBe(
      'Pathstream | Interview Confirmation for Engineering Manager',
    );
    expect(row.originalCompany).toBe('Pathstream');
    expect(row.classification).toBe('Scheduling');
    expect(row.classificationConfidence).toBeGreaterThanOrEqual(75);
    expect(row.classification).not.toBe('Other');
    expect(row.companyName).toBe('Pathstream');
    expect(row.positionTitle).toBe('Engineering Manager');
    expect(row.recruiterName).toBe('John Hardin');
    expect(row.interviewDetected).toBe(true);
    expect(row.interviewDatetime).toMatch(/^2026-07-05/);

    const app = db
      .select()
      .from(applications)
      .where(eq(applications.id, appId))
      .all()[0];
    expect(app.status).toBe('interviewing');
    expect(app.interviewDate).toBe('2026-07-05');

    const appContacts = db.select().from(contacts).all();
    expect(appContacts).toHaveLength(1);
    expect(appContacts[0].email).toBe('jhardin@pathstream.com');
    expect(appContacts[0].name).toBe('John Hardin');
    expect(appContacts[0].applicationId).toBe(appId);
    expect(appContacts[0].company).toBe('Pathstream');

    const comms = db.select().from(communications).all();
    expect(comms).toHaveLength(1);
    expect(comms[0].applicationId).toBe(appId);
    expect(comms[0].contactId).toBe(appContacts[0].id);
    expect(comms[0].direction).toBe('inbound');
  });
});
