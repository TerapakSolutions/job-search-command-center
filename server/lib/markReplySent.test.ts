/** @jest-environment node */
import { communications, contacts, emailApplicationLinks, emailAutomationAuditLog } from '../db/schema.js';
import {
  markReplySent,
  recordEmailAutomationAudit,
  setEmailApplicationLink,
} from './emailAutomationService.js';
import { aggregateBriefingData } from './briefingAggregator.js';
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';

const USER_EMAIL = 'seeker@example.com';
// 2026-11-19 20:00 UTC is 12:00 the same day in Pacific time.
const NOW = new Date('2026-11-19T20:00:00.000Z');

function seedContact(
  db: ReturnType<typeof createTestDb>,
  userId: string,
  applicationId: string,
  email: string,
  id = 'contact-1',
) {
  db.insert(contacts)
    .values({
      id,
      userId,
      applicationId,
      name: 'Nick Gasparro',
      email,
      lastContactDate: '2026-11-10',
      createdAt: '2026-11-10T00:00:00.000Z',
      updatedAt: '2026-11-10T00:00:00.000Z',
    })
    .run();
  return id;
}

function seedDraft(db: ReturnType<typeof createTestDb>, userId: string, emailId: string) {
  return recordEmailAutomationAudit(db, {
    userId,
    inboundEmailId: emailId,
    actionType: 'draft_reply',
    confidence: null,
    details: { via: 'ai_draft_button' },
    resultingChanges: { source: 'llm' },
  });
}

// One user, one email linked to one application with Nick as its contact.
function setup() {
  const db = createTestDb();
  const userId = seedTestUser(db, { email: USER_EMAIL });
  const appId = seedApplication(db, userId, { status: 'recruiter_screen' });
  const emailId = seedInboundEmail(db, { toEmail: USER_EMAIL });
  expect(setEmailApplicationLink(db, userId, emailId, appId)).toBe(true);
  const contactId = seedContact(db, userId, appId, 'Nick.Gasparro@Afresh.example');
  const draftId = seedDraft(db, userId, emailId);
  return { db, userId, appId, emailId, contactId, draftId };
}

const input = (draftAuditLogId: string, to: string | null = 'Nick Gasparro <nick.gasparro@afresh.example>') => ({
  draftAuditLogId,
  subject: 'Re: Afresh Interview Request',
  body: 'Hi Nick, checking in on next steps.\n\nSteve',
  to,
});

describe('markReplySent', () => {
  it('logs an outbound email on the linked application and restarts the follow-up clock', () => {
    const { db, userId, appId, emailId, contactId, draftId } = setup();

    const result = markReplySent(db, userId, emailId, input(draftId), NOW);

    expect(result).toMatchObject({ status: 'logged', applicationId: appId, contactId });
    const rows = db.select().from(communications).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId,
      applicationId: appId,
      contactId,
      channel: 'email',
      direction: 'outbound',
      subject: 'Re: Afresh Interview Request',
      body: 'Hi Nick, checking in on next steps.\n\nSteve',
      occurredAt: NOW.toISOString(),
    });
    const contact = db.select().from(contacts).all()[0];
    expect(contact.lastContactDate).toBe('2026-11-19');
    const audit = db
      .select()
      .from(emailAutomationAuditLog)
      .all()
      .find((r) => r.actionType === 'record_communication');
    expect(JSON.parse(audit!.detailsJson)).toEqual({ via: 'mark_sent', draftAuditLogId: draftId });
  });

  it('logs once per draft: a second click returns the first entry', () => {
    const { db, userId, emailId, draftId } = setup();

    const first = markReplySent(db, userId, emailId, input(draftId), NOW);
    const second = markReplySent(db, userId, emailId, input(draftId), NOW);

    expect(second.status).toBe('already_logged');
    if (first.status !== 'logged' || second.status !== 'already_logged') throw new Error('unreachable');
    expect(second.communicationId).toBe(first.communicationId);
    expect(second.auditLogId).toBe(first.auditLogId);
    expect(db.select().from(communications).all()).toHaveLength(1);
  });

  it('logs a new draft for the same email separately', () => {
    const { db, userId, emailId, draftId } = setup();
    const secondDraft = seedDraft(db, userId, emailId);

    markReplySent(db, userId, emailId, input(draftId), NOW);
    const again = markReplySent(db, userId, emailId, input(secondDraft), NOW);

    expect(again.status).toBe('logged');
    expect(db.select().from(communications).all()).toHaveLength(2);
  });

  it('refuses when the email has no linked application, writing nothing', () => {
    const { db, userId, emailId, draftId } = setup();
    setEmailApplicationLink(db, userId, emailId, null);

    expect(markReplySent(db, userId, emailId, input(draftId), NOW)).toEqual({ status: 'no_application' });
    expect(db.select().from(communications).all()).toHaveLength(0);
    expect(db.select().from(contacts).all()[0].lastContactDate).toBe('2026-11-10');
  });

  it("refuses a link to another user's application", () => {
    const { db, userId, emailId, draftId } = setup();
    const otherUser = seedTestUser(db, { id: 'user-2', email: 'other@example.com' });
    const otherApp = seedApplication(db, otherUser, { id: 'app-other' });
    setEmailApplicationLink(db, userId, emailId, null);
    db.insert(emailApplicationLinks)
      .values({ id: 'link-x', userId, inboundEmailId: emailId, applicationId: otherApp, createdAt: NOW.toISOString() })
      .run();

    expect(markReplySent(db, userId, emailId, input(draftId), NOW)).toEqual({ status: 'no_application' });
    expect(db.select().from(communications).all()).toHaveLength(0);
  });

  it("returns not_found for another user's email", () => {
    const { db, emailId, draftId } = setup();
    const otherUser = seedTestUser(db, { id: 'user-2', email: 'other@example.com' });

    expect(markReplySent(db, otherUser, emailId, input(draftId), NOW)).toEqual({ status: 'not_found' });
    expect(db.select().from(communications).all()).toHaveLength(0);
  });

  it('refuses a draft id that is not a draft of this email', () => {
    const { db, userId, emailId } = setup();
    const otherEmail = seedInboundEmail(db, { id: 'email-2', toEmail: USER_EMAIL });
    const otherDraft = seedDraft(db, userId, otherEmail);

    expect(markReplySent(db, userId, emailId, input(otherDraft), NOW)).toEqual({ status: 'invalid_draft' });
    expect(markReplySent(db, userId, emailId, input('no-such-id'), NOW)).toEqual({ status: 'invalid_draft' });
    expect(db.select().from(communications).all()).toHaveLength(0);
  });

  it('logs without a contact when no contact on the application has the address', () => {
    const { db, userId, appId, emailId, draftId } = setup();
    // Same address, but on a different application: it doesn't count.
    const otherApp = seedApplication(db, userId, { id: 'app-2' });
    seedContact(db, userId, otherApp, 'someone@else.example', 'contact-2');

    const result = markReplySent(db, userId, emailId, input(draftId, 'someone@else.example'), NOW);

    expect(result).toMatchObject({ status: 'logged', applicationId: appId, contactId: null });
    const lastDates = db.select().from(contacts).all().map((c) => c.lastContactDate);
    expect(lastDates).toEqual(['2026-11-10', '2026-11-10']);
  });

  it('logs without a contact when the draft has no recipient', () => {
    const { db, userId, emailId, draftId } = setup();

    const result = markReplySent(db, userId, emailId, input(draftId, null), NOW);

    expect(result).toMatchObject({ status: 'logged', contactId: null });
    expect(db.select().from(contacts).all()[0].lastContactDate).toBe('2026-11-10');
  });

  it('caps the subject and body it stores', () => {
    const { db, userId, emailId, draftId } = setup();

    markReplySent(
      db,
      userId,
      emailId,
      { ...input(draftId), subject: 's'.repeat(800), body: 'b'.repeat(9000) },
      NOW,
    );

    const row = db.select().from(communications).all()[0];
    expect(row.subject).toHaveLength(500);
    expect(row.body).toHaveLength(5000);
  });
  // The point of #131: the briefing stops asking for a follow-up.
  it('clears the "No recruiter reply" follow-up in the daily briefing', () => {
    const { db, userId, emailId, draftId } = setup();
    const before = aggregateBriefingData(db, userId, NOW).followUpNeeded;
    expect(before).toHaveLength(1);
    expect(before[0].reason).toMatch(/No recruiter reply in 9 days/);

    markReplySent(db, userId, emailId, input(draftId), NOW);

    expect(aggregateBriefingData(db, userId, NOW).followUpNeeded).toEqual([]);
  });

  it("falls back to the contact this email created when the address doesn't match", () => {
    const { db, userId, appId, emailId, draftId } = setup();
    // The recruiter wrote from a second address; the contact kept the first.
    const contactId = seedContact(db, userId, appId, 'nick@agency.example', 'contact-2');
    recordEmailAutomationAudit(db, {
      userId,
      inboundEmailId: emailId,
      actionType: 'create_contact',
      confidence: 90,
      resultingChanges: { contactId, applicationId: appId, merged: true },
    });

    const result = markReplySent(db, userId, emailId, input(draftId, 'nick@new-firm.example'), NOW);

    expect(result).toMatchObject({ status: 'logged', contactId });
    const byId = Object.fromEntries(db.select().from(contacts).all().map((c) => [c.id, c.lastContactDate]));
    expect(byId).toEqual({ 'contact-1': '2026-11-10', 'contact-2': '2026-11-19' });
  });

  it('ignores a created contact on a different application', () => {
    const { db, userId, emailId, draftId } = setup();
    const otherApp = seedApplication(db, userId, { id: 'app-2' });
    const contactId = seedContact(db, userId, otherApp, 'nick@agency.example', 'contact-2');
    recordEmailAutomationAudit(db, {
      userId,
      inboundEmailId: emailId,
      actionType: 'create_contact',
      confidence: 90,
      resultingChanges: { contactId },
    });

    const result = markReplySent(db, userId, emailId, input(draftId, 'nick@new-firm.example'), NOW);

    expect(result).toMatchObject({ status: 'logged', contactId: null });
  });

  it('never moves the last-contact date backwards', () => {
    const { db, userId, emailId, contactId, draftId } = setup();
    // An evening email stored as tomorrow's UTC day.
    db.update(contacts).set({ lastContactDate: '2026-11-20' }).run();

    const result = markReplySent(db, userId, emailId, input(draftId), NOW);

    expect(result).toMatchObject({ status: 'logged', contactId });
    expect(db.select().from(contacts).all()[0].lastContactDate).toBe('2026-11-20');
  });

  it('uses the Pacific day late in the evening', () => {
    const { db, userId, emailId, draftId } = setup();

    markReplySent(db, userId, emailId, input(draftId), new Date('2026-11-20T05:00:00.000Z'));

    expect(db.select().from(contacts).all()[0].lastContactDate).toBe('2026-11-19');
  });

  it("falls back to a Re: of the email's subject when none is given", () => {
    const { db, userId, emailId, draftId } = setup();

    markReplySent(db, userId, emailId, { ...input(draftId), subject: '  ' }, NOW);

    expect(db.select().from(communications).all()[0].subject).toBe('Re: Test subject');
  });
  it('rolls everything back when the audit write fails, so a retry logs once', () => {
    const { db, userId, emailId, draftId } = setup();
    db.$client.exec(`CREATE TRIGGER fail_mark_sent BEFORE INSERT ON email_automation_audit_log
      WHEN NEW.action_type = 'record_communication'
      BEGIN SELECT RAISE(ABORT, 'audit write failed'); END;`);

    expect(() => markReplySent(db, userId, emailId, input(draftId), NOW)).toThrow(/audit write failed/);
    expect(db.select().from(communications).all()).toHaveLength(0);
    expect(db.select().from(contacts).all()[0].lastContactDate).toBe('2026-11-10');

    db.$client.exec('DROP TRIGGER fail_mark_sent');
    expect(markReplySent(db, userId, emailId, input(draftId), NOW).status).toBe('logged');
    expect(db.select().from(communications).all()).toHaveLength(1);
  });

  it('ignores a create_contact the user declined', () => {
    const { db, userId, appId, emailId, draftId } = setup();
    const contactId = seedContact(db, userId, appId, 'nick@agency.example', 'contact-2');
    recordEmailAutomationAudit(db, {
      userId,
      inboundEmailId: emailId,
      actionType: 'create_contact',
      confidence: 90,
      status: 'rejected',
      resultingChanges: { contactId },
    });

    const result = markReplySent(db, userId, emailId, input(draftId, 'nick@new-firm.example'), NOW);

    expect(result).toMatchObject({ status: 'logged', contactId: null });
  });
});
