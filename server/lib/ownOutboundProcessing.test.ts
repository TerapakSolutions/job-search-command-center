/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { applications, communications, contacts, inboundEmails } from '../db/schema.js';
import { classifyInboundEmailWithLlm } from './emailClassificationEngine.js';
import { createContactFromEmail } from './emailAutomationService.js';
import { processInboundEmail } from './inboundEmailProcessingService.js';
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

describe('a closed thread reopens when the recruiter genuinely writes', () => {
  const closed = { threadClosedAt: '2026-11-14T00:00:00.000Z', declineDetectedAt: DECLINE_AT, messageNotes: 'Secondary vendor: x' };
  const S = 'FW: RE: Solutions Architect - Initech - Remote';

  it('clears the close, restarts the clock, and survives a secondary-vendor note', async () => {
    const ctx = setup(VENDOR_B, closed);
    await receive(ctx, 'e-1', S, vendorBRealReply, '2026-11-23T17:45:00.000Z');
    expect(contact(ctx)).toMatchObject({ threadClosedAt: null, declineDetectedAt: null, lastContactDate: '2026-11-23' });
    expect(contact(ctx).threadKeptOpenAt).not.toBeNull();
  });

  it('a later close sticks when the same mail is re-analyzed', async () => {
    const ctx = setup(VENDOR_B, closed);
    await receive(ctx, 'e-1', S, vendorBRealReply, '2026-11-23T17:45:00.000Z');
    ctx.db.update(contacts).set({ threadClosedAt: '2026-11-24T00:00:00.000Z' }).run();
    await processInboundEmail(ctx.db, 'e-1', { userId: ctx.userId, reanalysis: true, manual: true });
    expect(contact(ctx).threadClosedAt).toBe('2026-11-24T00:00:00.000Z');
  });

  it.each([
    ['a mail sent before the close', vendorBRealReply.replace('Monday, November 23', 'Thursday, November 12')],
    ['your own mail', vendorBQuestionForward],
  ])('stays closed for %s', async (_l, body) => {
    const ctx = setup(VENDOR_B, closed);
    await receive(ctx, 'e-1', S, body, '2026-11-23T17:45:00.000Z');
    expect(contact(ctx).threadClosedAt).toBe(closed.threadClosedAt);
  });

  it('stays closed for a bulk re-send', async () => {
    const ctx = setup(VENDOR_B, closed);
    await receive(ctx, 'e-0', S, vendorBQuestionForward, '2026-11-13T16:52:00.000Z');
    await receive(ctx, 'e-1', 'FW: Solutions Architect - Initech - Remote', vendorBMassResend, '2026-11-23T17:45:00.000Z');
    expect(contact(ctx).threadClosedAt).toBe(closed.threadClosedAt);
  });
});
