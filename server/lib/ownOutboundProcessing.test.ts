/** @jest-environment node */
import { eq } from 'drizzle-orm';
import {
  applications, communications, contacts, emailApplicationLinks, emailAutomationAuditLog, inboundEmails,
} from '../db/schema.js';
import { classifyInboundEmailWithLlm } from './emailClassificationEngine.js';
import { createContactFromEmail } from './emailAutomationService.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
import { ProcessingTimelineBuilder } from './processingTimeline.js';
import { computeReminders } from '../../src/lib/reminders.js';
import type { Application } from '../../src/types/application.js';
import type { Contact } from '../../src/types/contact.js';
import * as matcher from './emailApplicationMatcher.js';
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';
import {
  SEEKER, SEEKER_NAME, TP_RECRUITER, VENDOR_A, VENDOR_B,
  tpFollowUpForward, tpInbound, vendorADeclineForward, vendorBMassResend, vendorBQuestionForward, vendorBRealReply,
} from './__fixtures__/pingRecruiterThreads.js';

// Rules only, no LLM: what a paused AI budget gives in production.
jest.mock('./emailClassificationEngine.js', () => {
  const actual = jest.requireActual('./emailClassificationEngine.js') as typeof import('./emailClassificationEngine.js');
  return { ...actual, classifyInboundEmailWithLlm: jest.fn().mockResolvedValue(null) };
});

jest.mock('./emailApplicationMatcher.js', () => {
  const actual = jest.requireActual('./emailApplicationMatcher.js') as typeof import('./emailApplicationMatcher.js');
  return { ...actual, matchEmailToApplications: jest.fn(actual.matchEmailToApplications) };
});

const DECLINE_AT = '2026-11-10T23:18:37.000Z';

function setup(address = VENDOR_A, over: Partial<typeof contacts.$inferInsert> = {}, roleTitle = 'Unknown role') {
  const db = createTestDb();
  const userId = seedTestUser(db, { email: SEEKER, name: SEEKER_NAME });
  seedApplication(db, userId, { id: 'app-1', company: 'Globex Insurance', status: 'recruiter_screen' });
  db.update(applications).set({ roleTitle }).run();
  db.insert(contacts).values({
    id: 'c-1', userId, applicationId: 'app-1', name: 'Saved Recruiter', email: address,
    lastContactDate: '2026-11-01', createdAt: 't', updatedAt: 't', ...over,
  }).run();
  return { db, userId };
}
type Ctx = ReturnType<typeof setup>;

async function receive(ctx: Ctx, id: string, subject: string, textBody: string, receivedAt: string, from = SEEKER, fromName = SEEKER_NAME) {
  seedInboundEmail(ctx.db, {
    id, fromEmail: from, toEmail: 'inbox@app.example', subject, receivedAt,
    payload: JSON.stringify({ TextBody: textBody, FromName: fromName }),
  });
  return processInboundEmail(ctx.db, id, { userId: ctx.userId });
}
const contact = (ctx: Ctx, id = 'c-1') => ctx.db.select().from(contacts).where(eq(contacts.id, id)).get()!;
const comms = (ctx: Ctx) => ctx.db.select().from(communications).all();
const decline = (ctx: Ctx, body = vendorADeclineForward, at = DECLINE_AT, id = 'e-1') =>
  receive(ctx, id, 'FW: RE: Contract Data Engineer - Globex Insurance', body, at);
const withTop = (text: string) => vendorADeclineForward.replace(/Thanks for reaching out\.[\s\S]*?Happy to hear about other roles\./, text);

describe('your own forwarded mail, through processInboundEmail (rules, no LLM)', () => {
  it('a follow-up is logged outbound and restarts the clock', async () => {
    const ctx = setup(TP_RECRUITER);
    expect((await receive(ctx, 'e-1', 'FW: RE: Platform Engineer - Acme Bank', tpFollowUpForward, '2026-11-10T16:20:00.000Z')).processingStatus).toBe('processed');
    expect(comms(ctx).map((c) => [c.direction, c.contactId, c.applicationId])).toEqual([['outbound', 'c-1', 'app-1']]);
    expect(contact(ctx)).toMatchObject({ lastContactDate: '2026-11-10', declineDetectedAt: null });
  });

  it('a decline flags the thread, whatever the classification', async () => {
    const ctx = setup();
    await decline(ctx);
    expect(comms(ctx).map((c) => c.direction)).toEqual(['outbound']);
    expect(contact(ctx)).toMatchObject({ lastContactDate: '2026-11-10', declineDetectedAt: DECLINE_AT, threadClosedAt: null });
  });

  it('is idempotent: Re-analyze adds nothing and does not undo "Keep open"', async () => {
    const ctx = setup();
    await decline(ctx);
    ctx.db.update(contacts).set({ declineDetectedAt: null }).run();
    await processInboundEmail(ctx.db, 'e-1', { userId: ctx.userId, reanalysis: true, manual: true });
    createContactFromEmail(ctx.db, ctx.userId, 'e-1', 'app-1');
    expect(comms(ctx)).toHaveLength(1);
    expect(contact(ctx).declineDetectedAt).toBeNull();
  });

  it('a "create contact" run counts too: Re-analyze after it does not undo "Keep open"', async () => {
    const ctx = setup(VENDOR_A, { email: 'x@vendor-z.example' });
    await decline(ctx); // unknown counterparty: nothing applied yet
    createContactFromEmail(ctx.db, ctx.userId, 'e-1', 'app-1');
    const made = ctx.db.select().from(contacts).where(eq(contacts.email, VENDOR_A)).get()!;
    expect(made.declineDetectedAt).toBe(DECLINE_AT);
    ctx.db.update(contacts).set({ declineDetectedAt: null }).run();
    await processInboundEmail(ctx.db, 'e-1', { userId: ctx.userId, reanalysis: true, manual: true });
    expect(contact(ctx, made.id).declineDetectedAt).toBeNull();
    expect(comms(ctx)).toHaveLength(1);
  });

  it('does not log twice when "create contact" already logged the email', async () => {
    const ctx = setup();
    // The "elsewhere" wording classifies as Already Submitted Elsewhere, which runs create_contact itself.
    await decline(ctx, withTop("I've already been submitted to this role through another vendor, so please don't submit my profile."));
    expect(comms(ctx)).toHaveLength(1);
    expect(contact(ctx).declineDetectedAt).toBe(DECLINE_AT);
  });

  it('creates no contact or application for an unknown counterparty', async () => {
    const ctx = setup('someone.else@vendor-z.example');
    await decline(ctx);
    expect(ctx.db.select().from(contacts).all()).toHaveLength(1);
    expect(ctx.db.select().from(applications).all()).toHaveLength(1);
    expect(comms(ctx)).toHaveLength(0);
  });

  it("never touches another user's contact with the same address", async () => {
    const ctx = setup('nobody@vendor-z.example');
    const other = seedTestUser(ctx.db, { id: 'user-2', email: 'other@seeker.example' });
    seedApplication(ctx.db, other, { id: 'app-other', company: 'Globex Insurance', status: 'recruiter_screen' });
    ctx.db.update(applications).set({ roleTitle: 'Unknown role' }).run();
    ctx.db.insert(contacts).values({
      id: 'c-other', userId: other, applicationId: 'app-other', name: 'Maya Lund', email: VENDOR_A,
      lastContactDate: '2026-11-01', createdAt: 't', updatedAt: 't',
    }).run();
    await decline(ctx);
    expect(contact(ctx, 'c-other')).toMatchObject({ lastContactDate: '2026-11-01', declineDetectedAt: null });
    expect(comms(ctx)).toHaveLength(0);
  });

  it('does not guess between two applications with the same recruiter', async () => {
    const ctx = setup();
    seedApplication(ctx.db, ctx.userId, { id: 'app-2', company: 'Hooli', status: 'recruiter_screen' });
    ctx.db.update(applications).set({ roleTitle: 'Unknown role' }).run();
    ctx.db.insert(contacts).values({
      id: 'c-2', userId: ctx.userId, applicationId: 'app-2', name: 'Saved Recruiter', email: VENDOR_A,
      lastContactDate: '2026-11-01', createdAt: 't', updatedAt: 't',
    }).run();
    await decline(ctx, vendorADeclineForward.replace(/Globex Insurance/g, 'Client'));
    expect([contact(ctx), contact(ctx, 'c-2')].map((c) => c.declineDetectedAt)).toEqual([null, null]);
  });

  it('a mail naming a different role by the same recruiter leaves the thread alone', async () => {
    const named = async (appRole: string) => {
      const ctx = setup(VENDOR_A, {}, appRole);
      (classifyInboundEmailWithLlm as jest.Mock).mockResolvedValueOnce({
        classification: 'Other', classificationConfidence: 40, companyName: null, positionTitle: 'Data Engineer',
        recruiterName: null, requiresResponse: false, suggestedAction: '', actionDueAt: null,
        interviewDetected: false, interviewDatetime: null, aiSummary: '',
      });
      await decline(ctx);
      expect(ctx.db.select().from(inboundEmails).get()!.positionTitle).toBe('Data Engineer');
      return contact(ctx);
    };
    expect(await named('Pastry Chef')).toMatchObject({ declineDetectedAt: null, lastContactDate: '2026-11-01' });
    expect((await named('Data Engineer')).declineDetectedAt).toBe(DECLINE_AT);
  });

  it('a recruiter who forwards their own message is not you', async () => {
    const ctx = setup();
    const theirs = vendorADeclineForward.replace(/Jordan Pike <[^>]*>/g, 'Maya Lund <tmp>')
      .replace(/Maya Lund <tmp>/, `Maya Lund <${VENDOR_A}>`).replace(/To: Maya Lund <[^>]*>/, `To: Desk <${VENDOR_A}>`);
    await receive(ctx, 'e-1', 'FW: RE: Contract Data Engineer - Globex Insurance', theirs, DECLINE_AT, VENDOR_A, 'Maya Lund');
    expect(contact(ctx).declineDetectedAt).toBeNull();
    createContactFromEmail(ctx.db, ctx.userId, 'e-1', 'app-1');
    expect(contact(ctx).declineDetectedAt).toBeNull();
  });

  it('never moves the clock backwards', async () => {
    const ctx = setup(VENDOR_A, { lastContactDate: '2026-11-20' });
    await decline(ctx);
    expect(contact(ctx).lastContactDate).toBe('2026-11-20');
  });
});

describe('only your own words count', () => {
  const quoted = "please don't submit my profile; I'm no longer interested";
  it.each([
    ['Outlook header block', `Any update?\n\n________________________________\nFrom: Maya Lund <${VENDOR_A}>\nSent: Tuesday, November 10, 2026 1:04 PM\nTo: Jordan Pike <${SEEKER}>\nSubject: x\n\n${quoted}`],
    ['On … wrote: (no marks)', `Any update?\n\nOn Tue, Nov 10, 2026 at 1:04 PM Maya Lund <${VENDOR_A}> wrote:\n\n${quoted}`],
    ['On … wrote: wrapped', `Any update?\n\nOn Tue, Nov 10, 2026 at 1:04 PM Maya Lund <${VENDOR_A}>\nwrote:\n\n${quoted}`],
    ['inline > marks', `Any update?\n> ${quoted}\nThanks`],
    ['nothing but a quote', `> ${quoted}`],
  ])('quoted decline text is ignored: %s', async (_l, text) => {
    const ctx = setup();
    const head = vendorADeclineForward.slice(0, vendorADeclineForward.indexOf('Hi Maya,'));
    await decline(ctx, `${head}${text}\n`);
    expect(contact(ctx).declineDetectedAt).toBeNull();
    createContactFromEmail(ctx.db, ctx.userId, 'e-1', 'app-1');
    expect(contact(ctx).declineDetectedAt).toBeNull();
  });

  it('a recruiter writing the same words is not your decline', async () => {
    const ctx = setup(TP_RECRUITER);
    await receive(ctx, 'e-1', 'FW: Platform Engineer - Acme Bank', tpInbound.replace('Thanks for your time today.', `You said: ${quoted}.`), DECLINE_AT);
    createContactFromEmail(ctx.db, ctx.userId, 'e-1', 'app-1');
    expect(contact(ctx).declineDetectedAt).toBeNull();
  });

  it('"create contact" on an existing contact reads your top message only', () => {
    const run = (body: string) => {
      const ctx = setup();
      seedInboundEmail(ctx.db, {
        id: 'e-1', fromEmail: SEEKER, toEmail: 'inbox@app.example', subject: 'FW: RE: Contract Data Engineer', receivedAt: DECLINE_AT,
        payload: JSON.stringify({ TextBody: body, FromName: SEEKER_NAME }), classification: 'Other',
      });
      ctx.db.update(inboundEmails).set({ isForwarded: true, originalSenderEmail: VENDOR_A }).run();
      createContactFromEmail(ctx.db, ctx.userId, 'e-1', 'app-1');
      return contact(ctx).declineDetectedAt;
    };
    expect(run(vendorADeclineForward)).toBe(DECLINE_AT);
    expect(run(withTop('Any update?').replace('Are you interested?', quoted))).toBeNull();
  });
});

describe('a closed thread reopens when the recruiter writes something that needs a reply', () => {
  const ask = vendorBRealReply.replace('Yes, fully remote, 12 months with a likely extension.', 'The client would like to schedule an interview with you. Please let me know your availability.');
  const closed = { threadClosedAt: '2026-11-14T00:00:00.000Z', declineDetectedAt: DECLINE_AT, messageNotes: 'Secondary vendor: x' };
  const S = 'FW: RE: Solutions Architect - Initech - Remote';

  it('clears the close, restarts the clock, and survives a secondary-vendor note', async () => {
    const ctx = setup(VENDOR_B, closed);
    await receive(ctx, 'e-1', S, ask, '2026-11-23T17:45:00.000Z');
    expect(contact(ctx)).toMatchObject({ threadClosedAt: null, declineDetectedAt: null, lastContactDate: '2026-11-23' });
    expect(contact(ctx).threadKeptOpenAt).not.toBeNull();
  });

  it('a later close sticks when the same mail is re-analyzed', async () => {
    const ctx = setup(VENDOR_B, closed);
    await receive(ctx, 'e-1', S, ask, '2026-11-23T17:45:00.000Z');
    ctx.db.update(contacts).set({ threadClosedAt: '2026-11-24T00:00:00.000Z' }).run();
    await processInboundEmail(ctx.db, 'e-1', { userId: ctx.userId, reanalysis: true, manual: true });
    expect(contact(ctx).threadClosedAt).toBe('2026-11-24T00:00:00.000Z');
  });

  it.each([
    ['a mail sent before the close', ask.replace('Monday, November 23', 'Thursday, November 12')],
    ['your own mail', vendorBQuestionForward],
    ['an acknowledgment', vendorBRealReply.replace('Yes, fully remote, 12 months with a likely extension.', "Thanks, noted. I'll keep you in mind for other roles.")],
  ])('stays closed for %s', async (_l, body) => {
    const ctx = setup(VENDOR_B, closed);
    await receive(ctx, 'e-1', S, body, '2026-11-23T17:45:00.000Z');
    expect(contact(ctx).threadClosedAt).toBe(closed.threadClosedAt);
  });

  it('stays closed for a bulk re-send', async () => {
    const ctx = setup(VENDOR_B, closed);
    await receive(ctx, 'e-0', S, vendorBQuestionForward, '2026-11-13T16:52:00.000Z');
    await receive(ctx, 'e-1', 'FW: Solutions Architect - Initech - Remote', vendorBMassResend.replace('Reply with your updated resume.', 'The client would like to schedule an interview with you. Please let me know your availability.'), '2026-11-23T17:45:00.000Z');
    expect(ctx.db.select().from(inboundEmails).where(eq(inboundEmails.id, 'e-1')).get()!.requiresResponse).toBe(true);
    expect(contact(ctx).threadClosedAt).toBe(closed.threadClosedAt);
  });
});

describe('a failing signal step never fails the email', () => {
  let logged: jest.SpyInstance;
  beforeEach(() => {
    logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => logged.mockRestore());

  const badAudit = (ctx: Ctx) =>
    ctx.db.insert(emailAutomationAuditLog).values({
      id: 'bad', userId: ctx.userId, inboundEmailId: 'e-1', actionType: 'create_contact', status: 'completed',
      detailsJson: '{not json SECRET', resultingChangesJson: '{}', createdAt: 't',
    }).run();
  const email = (ctx: Ctx) => ctx.db.select().from(inboundEmails).where(eq(inboundEmails.id, 'e-1')).get()!;

  // The email still finishes, the failure shows, and nothing private is logged.
  function expectFinishedWithVisibleFailure(ctx: Ctx, result: { processingStatus: string }) {
    expect(result.processingStatus).toBe('processed');
    expect(email(ctx)).toMatchObject({ processingStatus: 'processed', processingError: null });
    const steps = ProcessingTimelineBuilder.parse(email(ctx).processingTimelineJson)!.steps;
    expect(steps.find((s) => s.step === 'safe_actions_applied')).toMatchObject({
      status: 'failed', message: expect.stringContaining('Follow-up tracking failed'), error: 'thread_signals_failed',
    });
    expect(steps.find((s) => s.step === 'processing_completed')?.status).toBe('completed');
    const audit = ctx.db.select().from(emailAutomationAuditLog).all().find((a) => a.actionType === 'auto_process');
    expect(JSON.parse(audit!.detailsJson)).toMatchObject({ threadSignalsFailed: true });
    const mine = logged.mock.calls.filter((c) => String(c[0]).includes('thread_signals_failed'));
    expect(mine).toEqual([['[inbound-processing] thread_signals_failed', { emailId: 'e-1', error: expect.any(String) }]]);
    expect(JSON.stringify(mine)).not.toMatch(/SECRET|@|Maya|Jordan/);
  }

  it('malformed audit row', async () => {
    const ctx = setup();
    seedInboundEmail(ctx.db, {
      id: 'e-1', fromEmail: SEEKER, toEmail: 'inbox@app.example', subject: 'FW: RE: x', receivedAt: DECLINE_AT,
      payload: JSON.stringify({ TextBody: vendorADeclineForward, FromName: SEEKER_NAME }),
    });
    badAudit(ctx);
    expectFinishedWithVisibleFailure(ctx, await processInboundEmail(ctx.db, 'e-1', { userId: ctx.userId }));
    expect(contact(ctx)).toMatchObject({ lastContactDate: '2026-11-01', declineDetectedAt: null });
  });

  it('malformed audit row, on a label that runs "create contact"', async () => {
    const ctx = setup();
    seedInboundEmail(ctx.db, {
      id: 'e-1', fromEmail: SEEKER, toEmail: 'inbox@app.example', subject: 'FW: RE: x', receivedAt: DECLINE_AT,
      payload: JSON.stringify({
        TextBody: withTop("I've already been submitted to this role through another vendor."), FromName: SEEKER_NAME,
      }),
    });
    ctx.db.insert(emailApplicationLinks).values({
      id: 'l-1', userId: ctx.userId, inboundEmailId: 'e-1', applicationId: 'app-1', createdAt: 't',
    }).run();
    badAudit(ctx);
    expectFinishedWithVisibleFailure(ctx, await processInboundEmail(ctx.db, 'e-1', { userId: ctx.userId }));
    // "create contact" itself still ran, without guessing the decline flag.
    expect(comms(ctx).map((c) => c.direction)).toEqual(['outbound']);
    expect(contact(ctx).declineDetectedAt).toBeNull();
  });

  it('a throw mid-write leaves no partial row, and a retry applies once', async () => {
    const ctx = setup();
    ctx.db.$client.exec(`CREATE TRIGGER fail_signal BEFORE INSERT ON email_automation_audit_log
      WHEN NEW.action_type = 'record_communication' BEGIN SELECT RAISE(ABORT, 'SECRET'); END;`);
    expectFinishedWithVisibleFailure(ctx, await decline(ctx));
    expect(comms(ctx)).toHaveLength(0);
    expect(contact(ctx)).toMatchObject({ lastContactDate: '2026-11-01', declineDetectedAt: null });

    ctx.db.$client.exec('DROP TRIGGER fail_signal');
    await processInboundEmail(ctx.db, 'e-1', { userId: ctx.userId, reanalysis: true, manual: true });
    expect(comms(ctx)).toHaveLength(1);
    expect(contact(ctx).declineDetectedAt).toBe(DECLINE_AT);
  });
});

describe('the clock uses the day you sent it', () => {
  const S = 'FW: RE: Platform Engineer - Acme Bank';
  const pings = (ctx: Ctx, day: string) =>
    computeReminders(
      ctx.db.select().from(applications).all() as unknown as Application[],
      ctx.db.select().from(contacts).all() as unknown as Contact[],
      new Date(`${day}T12:00:00`),
    ).map((r) => r.type);

  it('AC4 forwarded late: sent 11-10, forwarded 11-23, still nudges 11-24', async () => {
    const ctx = setup(TP_RECRUITER, { lastContactDate: '2026-10-26' });
    await receive(ctx, 'e-1', S, tpFollowUpForward, '2026-11-23T18:00:00.000Z');
    expect(contact(ctx).lastContactDate).toBe('2026-11-10');
    expect(comms(ctx)[0].occurredAt).toBe('2026-11-10T16:19:00.000Z');
    expect(pings(ctx, '2026-11-24')).toEqual(['recruiter_no_reply']);
  });

  it('the same through "create contact"', () => {
    const ctx = setup(TP_RECRUITER, { lastContactDate: '2026-10-26' });
    seedInboundEmail(ctx.db, {
      id: 'e-1', fromEmail: SEEKER, toEmail: 'inbox@app.example', subject: S, receivedAt: '2026-11-23T18:00:00.000Z',
      payload: JSON.stringify({ TextBody: tpFollowUpForward, FromName: SEEKER_NAME }),
    });
    ctx.db.update(inboundEmails).set({ isForwarded: true, originalSenderEmail: TP_RECRUITER }).run();
    createContactFromEmail(ctx.db, ctx.userId, 'e-1', 'app-1');
    expect(contact(ctx).lastContactDate).toBe('2026-11-10');
    expect(comms(ctx)[0].occurredAt).toBe('2026-11-10T16:19:00.000Z');
  });

  it.each([
    ['does not parse', 'Sent: sometime'],
    ['is after we received it', 'Sent: Tuesday, December 1, 2026 8:19 AM'],
  ])('falls back to the received day when the sent date %s', async (_l, sent) => {
    const ctx = setup(TP_RECRUITER, { lastContactDate: '2026-10-26' });
    await receive(ctx, 'e-1', S, tpFollowUpForward.replace('Sent: Tuesday, November 10, 2026 8:19 AM', sent), '2026-11-23T18:00:00.000Z');
    expect(contact(ctx).lastContactDate).toBe('2026-11-23');
  });

  it('never moves backwards for a late forward of an older message', async () => {
    const ctx = setup(TP_RECRUITER, { lastContactDate: '2026-11-20' });
    await receive(ctx, 'e-1', S, tpFollowUpForward, '2026-11-23T18:00:00.000Z');
    expect(contact(ctx).lastContactDate).toBe('2026-11-20');
  });

  it('"create contact" stores the Pacific day, like the rest', () => {
    const ctx = setup('x@vendor-z.example');
    for (const [id, from] of [['e-1', 'x@vendor-z.example'], ['e-2', 'new@vendor-z.example']]) {
      seedInboundEmail(ctx.db, { id, fromEmail: from, toEmail: SEEKER, receivedAt: '2026-11-24T02:00:00.000Z' });
      createContactFromEmail(ctx.db, ctx.userId, id, 'app-1');
    }
    expect(ctx.db.select().from(contacts).all().map((c) => c.lastContactDate)).toEqual(['2026-11-23', '2026-11-23']);
  });
});

describe('labels, re-runs and cost', () => {
  it('a quoted "already submitted elsewhere" does not flag you, your own words do', async () => {
    const claim = "I've already been submitted through another vendor.";
    const quoted = setup();
    await decline(quoted, withTop('Any update?\n> ' + claim));
    expect(quoted.db.select().from(inboundEmails).get()!.classification).toBe('Already Submitted Elsewhere');
    expect(contact(quoted).declineDetectedAt).toBeNull();
    const own = setup();
    await decline(own, withTop(claim + '\n> Any interest?'));
    expect(contact(own).declineDetectedAt).toBe(DECLINE_AT);
  });

  it("an email's own logged copy is not an earlier subject", async () => {
    const ctx = setup(VENDOR_B);
    const body = vendorBMassResend.replace('Reply with your updated resume.', 'The client would like to schedule an interview with you. Please let me know your availability.');
    await receive(ctx, 'e-1', 'FW: Solutions Architect - Initech - Remote', body, '2026-11-23T17:45:00.000Z');
    createContactFromEmail(ctx.db, ctx.userId, 'e-1', 'app-1');
    expect(comms(ctx).length).toBeGreaterThan(0);
    ctx.db.update(contacts).set({ threadClosedAt: '2026-11-14T00:00:00.000Z' }).run();
    await processInboundEmail(ctx.db, 'e-1', { userId: ctx.userId, reanalysis: true, manual: true });
    expect(contact(ctx).threadClosedAt).toBeNull();
  });

  it.each([
    ['your mail to someone who is not a contact', 'x@vendor-z.example', vendorADeclineForward],
    ['a recruiter whose thread is not closed', VENDOR_B, vendorBRealReply],
  ])('matches applications no extra time for %s', async (_l, address, body) => {
    const ctx = setup(address);
    (matcher.matchEmailToApplications as jest.Mock).mockClear();
    await receive(ctx, 'e-1', 'FW: x', body, DECLINE_AT);
    // Once in processing, once in the automation rules.
    expect(matcher.matchEmailToApplications).toHaveBeenCalledTimes(2);
  });
});
