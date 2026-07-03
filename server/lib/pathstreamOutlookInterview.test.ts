/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { applications, inboundEmails, interviews } from '../db/schema.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import {
  createTestDb,
  seedApplication,
  seedInboundEmail,
  seedTestUser,
} from './testDb.js';

jest.mock('./emailClassificationEngine.js', () => {
  const actual = jest.requireActual(
    './emailClassificationEngine.js',
  ) as typeof import('./emailClassificationEngine.js');
  return {
    classifyInboundEmailWithLlm: jest.fn().mockResolvedValue(null),
    classifyInboundEmailWithRules: actual.classifyInboundEmailWithRules,
  };
});

// TextBody captured from the real production inbound_emails row, byte-verbatim
// (only the email's surrounding blank-line padding is trimmed — immaterial to
// parsing). Outlook forward: underscore divider + From:/Sent:/To:/Subject:
// block, then the confirmation body with inline weekday phrasing and a labeled
// Date/Time: line. This is the exact content that previously classified
// correctly but produced NO interview record because the datetime never parsed.
const REAL_OUTLOOK_TEXTBODY = `________________________________
From: Jon Hardin <jhardin@pathstream.com>
Sent: Thursday, July 2, 2026 8:49 AM
To: Steve Terapak <steve@terapak.com>
Subject: Pathstream | Interview Confirmation for Engineering Manager


Hi Steve,

Thank you for sharing your availability for the Engineering Manager position at Pathstream. Your interview is now confirmed for Tuesday July 7, 6:00pm EST - 3:00pm PST with James Peel SVP of Engineering

This chat will be a great opportunity for us to discuss your background and skills and how they align with what we are looking for in this role. .

Please use the Zoom link below to join the meeting:

Date/Time: Jul 7, 2026 6:00pm-7:00pm (GMT-04:00) Eastern Time (US & Canada)
Interviewers: James Peel

Zoom: https://us06web.zoom.us/j/81000015841?pwd=ZHTOZYzASW9jWsXoxzQruDs4AQbZxC.1

Cheers,
Jon
--`;

describe('Pathstream Outlook interview confirmation (real email, datetime fix)', () => {
  it('extracts the interview datetime and creates the interview record end-to-end', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'steve@terapak.com' });
    const appId = seedApplication(db, userId, {
      id: 'app-pathstream-em',
      company: 'Pathstream',
      roleTitle: 'Engineering Manager',
      status: 'recruiter_screen',
    });

    const emailId = seedInboundEmail(db, {
      id: 'email-pathstream-outlook',
      toEmail: 'steve@terapak.com',
      fromEmail: 'steve@terapak.com',
      subject: 'Fw: Pathstream | Interview Confirmation for Engineering Manager',
      payload: JSON.stringify({ TextBody: REAL_OUTLOOK_TEXTBODY }),
      receivedAt: '2026-07-02T15:52:16.000Z',
    });

    const result = await processInboundEmail(db, emailId, { userId, manual: true });
    expect(result.processingStatus).toBe('processed');

    const row = db.select().from(inboundEmails).where(eq(inboundEmails.id, emailId)).all()[0];
    // Forward-parsing + classification were already correct; the fix is the datetime.
    expect(row.classification).toBe('Scheduling');
    expect(row.companyName).toBe('Pathstream');
    expect(row.positionTitle).toBe('Engineering Manager');
    expect(row.interviewDetected).toBe(true);
    expect(row.interviewDatetime).toMatch(/^2026-07-07/); // was empty before the fix

    const app = db.select().from(applications).where(eq(applications.id, appId)).all()[0];
    expect(app.status).toBe('interviewing');

    const interviewRows = db.select().from(interviews).all();
    expect(interviewRows).toHaveLength(1);
    expect(interviewRows[0].applicationId).toBe(appId);
    expect(interviewRows[0].scheduledAt).toMatch(/^2026-07-07/);
  });
});
