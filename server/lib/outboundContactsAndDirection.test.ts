/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { communications, contacts, inboundEmails } from '../db/schema.js';
import { createContactFromEmail, hasCompletedAutomationAction } from './emailAutomationService.js';
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';
import { outlookOutboundTopNoNote } from './__fixtures__/outlookOutboundTopMessage.js';

const ME = 'steve@terapak.com';
const SUBJECT = 'FW: Solution Architect !! Location:  Example City !!';

function setup() {
  const db = createTestDb();
  const userId = seedTestUser(db, { email: ME });
  const appId = seedApplication(db, userId, { id: 'app-1', company: 'Client Co' });
  return { db, userId, appId };
}

describe('contacts and communications from emails you wrote', () => {
  it('never saves your own address as a contact when the original sender did not parse', () => {
    const { db, userId, appId } = setup();
    const emailId = seedInboundEmail(db, {
      id: 'email-unparsed',
      fromEmail: ME,
      toEmail: 'jobs@inbound.example',
      subject: 'Fw: next steps',
      payload: JSON.stringify({ TextBody: 'From: Someone\nSubject: next steps\n\nHi', FromName: 'Steve Terapak' }),
      classification: 'Follow-up Required',
      classificationConfidence: 85,
      recruiterName: 'Dana',
    });
    const result = createContactFromEmail(db, userId, emailId, appId);
    // Skipped, and reported as skipped, so nothing claims a contact was made.
    expect(result?.success).toBe(false);
    expect(result?.message).not.toMatch(/Created/i);
    expect(db.select().from(contacts).where(eq(contacts.userId, userId)).all()).toHaveLength(0);
    expect(db.select().from(communications).where(eq(communications.applicationId, appId)).all()).toHaveLength(0);
    // Not counted as done, so a later Re-analyze (once the real sender
    // parses) still creates the right contact.
    expect(hasCompletedAutomationAction(db, emailId, 'create_contact')).toBe(false);
  });

  it('logs your own reply as outbound, with the counterparty as the contact', () => {
    const { db, userId, appId } = setup();
    const emailId = seedInboundEmail(db, {
      id: 'email-outbound',
      fromEmail: ME,
      toEmail: 'jobs@inbound.example',
      subject: SUBJECT,
      payload: JSON.stringify({ TextBody: outlookOutboundTopNoNote, FromName: 'Steve Terapak' }),
      classification: 'Agreed to Submission',
      classificationConfidence: 85,
      recruiterName: 'Ravi Kumar',
    });
    // As persisted by classification (the seeder does not set these).
    db.update(inboundEmails)
      .set({
        isForwarded: true,
        originalSenderEmail: 'ravi.kumar@acmestaffing.example',
        originalSenderName: 'Ravi Kumar',
      })
      .where(eq(inboundEmails.id, emailId))
      .run();
    createContactFromEmail(db, userId, emailId, appId);
    const saved = db.select().from(contacts).where(eq(contacts.userId, userId)).all();
    expect(saved.map((c) => c.email)).toEqual(['ravi.kumar@acmestaffing.example']);
    const comms = db.select().from(communications).where(eq(communications.applicationId, appId)).all();
    expect(comms.map((c) => c.direction)).toEqual(['outbound']);
  });

  it('control: a recruiter email still creates the contact and is logged as inbound', () => {
    const { db, userId, appId } = setup();
    const emailId = seedInboundEmail(db, {
      id: 'email-inbound',
      fromEmail: 'ravi.kumar@acmestaffing.example',
      toEmail: ME,
      subject: 'Next steps',
      payload: JSON.stringify({ TextBody: 'Hi Steve, can we talk tomorrow?', FromName: 'Ravi Kumar' }),
      classification: 'Follow-up Required',
      classificationConfidence: 85,
      recruiterName: 'Ravi Kumar',
    });
    createContactFromEmail(db, userId, emailId, appId);
    const saved = db.select().from(contacts).where(eq(contacts.userId, userId)).all();
    expect(saved.map((c) => c.email)).toEqual(['ravi.kumar@acmestaffing.example']);
    const comms = db.select().from(communications).where(eq(communications.applicationId, appId)).all();
    expect(comms.map((c) => c.direction)).toEqual(['inbound']);
  });
});
