/** @jest-environment node */
import { and, eq } from 'drizzle-orm';
import { communications, contacts } from '../db/schema.js';
import { createContactFromEmail } from './emailAutomationService.js';
import { persistForwardMetadata } from './emailClassificationService.js';
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';
import {
  SEEKER,
  SEEKER_NAME,
  TP_RECRUITER,
  VENDOR_A,
  VENDOR_B,
  tpFollowUpForward,
  tpInbound,
  vendorADeclineForward,
  vendorBMassResend,
  vendorBQuestionForward,
  vendorBRealReply,
} from './__fixtures__/pingRecruiterThreads.js';

function setup() {
  const db = createTestDb();
  const userId = seedTestUser(db, { email: SEEKER, name: SEEKER_NAME });
  const appId = seedApplication(db, userId, { id: 'app-1', company: 'Acme Bank', status: 'recruiter_screen' });
  return { db, userId, appId };
}

/** Store a forward the way inbound processing does, then run "create contact" on it. */
function ingest(
  ctx: ReturnType<typeof setup>,
  email: { id: string; subject: string; textBody: string; receivedAt: string; classification?: string },
) {
  const { db, userId, appId } = ctx;
  seedInboundEmail(db, {
    id: email.id,
    fromEmail: SEEKER,
    toEmail: 'inbox@app.example',
    subject: email.subject,
    receivedAt: email.receivedAt,
    payload: JSON.stringify({ TextBody: email.textBody, FromName: SEEKER_NAME }),
    classification: email.classification ?? 'Other',
    classificationConfidence: 85,
  });
  persistForwardMetadata(db, email.id, {
    subject: email.subject,
    fromEmail: SEEKER,
    fromName: SEEKER_NAME,
    textBody: email.textBody,
  });
  return createContactFromEmail(db, userId, email.id, appId);
}

function contactFor(ctx: ReturnType<typeof setup>, address: string) {
  return ctx.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.userId, ctx.userId), eq(contacts.email, address)))
    .get();
}

function directionsFor(ctx: ReturnType<typeof setup>, contactId: string) {
  return ctx.db
    .select()
    .from(communications)
    .where(eq(communications.contactId, contactId))
    .all()
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .map((c) => c.direction);
}

describe('AC2: a forward whose inner sender is you is your follow-up', () => {
  it('logs it outbound against the recruiter and restarts the clock', () => {
    const ctx = setup();
    ingest(ctx, { id: 'tp-in', subject: 'FW: Platform Engineer - Acme Bank', textBody: tpInbound, receivedAt: '2026-10-26T17:58:00.000Z' });
    expect(contactFor(ctx, TP_RECRUITER)?.lastContactDate).toBe('2026-10-26');

    ingest(ctx, { id: 'tp-out', subject: 'FW: RE: Platform Engineer - Acme Bank', textBody: tpFollowUpForward, receivedAt: '2026-11-10T16:20:00.000Z' });
    const recruiter = contactFor(ctx, TP_RECRUITER)!;
    expect(directionsFor(ctx, recruiter.id)).toEqual(['inbound', 'outbound']);
    expect(recruiter.lastContactDate).toBe('2026-11-10');
    // A follow-up is not a decline, though the quoted recruiter text says "not interested".
    expect(recruiter.declineDetectedAt).toBeNull();
  });
});

describe('AC1 + fixture A: "I followed up" survives a re-run of an older email', () => {
  it('re-processing the 11-11 inbound never moves the clock back from the 11-19 follow-up', () => {
    const ctx = setup();
    const first = { id: 'a-in', subject: 'FW: Platform Engineer - Acme Bank', textBody: tpInbound, receivedAt: '2026-11-11T06:35:00.000Z' };
    ingest(ctx, first);
    const recruiter = contactFor(ctx, TP_RECRUITER)!;
    expect(recruiter.lastContactDate).toBe('2026-11-11');
    // The click (sent by direct reply, never forwarded) as the Today page stores it.
    ctx.db.update(contacts).set({ lastContactDate: '2026-11-19' }).where(eq(contacts.id, recruiter.id)).run();
    // Re-analyze / Run all on the old email runs "create contact" again.
    createContactFromEmail(ctx.db, ctx.userId, first.id, ctx.appId);
    expect(contactFor(ctx, TP_RECRUITER)?.lastContactDate).toBe('2026-11-19');
  });
});

describe('AC3: a forwarded decline suggests closing the thread', () => {
  it('flags the vendor contact when your top message says "please don’t submit my profile"', () => {
    const ctx = setup();
    ingest(ctx, {
      id: 'b-decline',
      subject: 'FW: RE: Contract Data Engineer - Globex Insurance',
      textBody: vendorADeclineForward,
      receivedAt: '2026-11-10T23:18:37.000Z',
    });
    const vendor = contactFor(ctx, VENDOR_A)!;
    expect(directionsFor(ctx, vendor.id)).toEqual(['outbound']);
    expect(vendor.declineDetectedAt).toBe('2026-11-10T23:18:37.000Z');
    // Suggested only: nothing is closed until you confirm.
    expect(vendor.threadClosedAt).toBeNull();
  });

  it('flags it from the "Already Submitted Elsewhere" label on your own reply too', () => {
    const ctx = setup();
    const neutral = vendorADeclineForward
      .replace(/I'm already represented[^\n]*\n/, 'I will pass on this one.\n');
    ingest(ctx, {
      id: 'b-label',
      subject: 'FW: RE: Contract Data Engineer - Globex Insurance',
      textBody: neutral,
      receivedAt: '2026-11-10T23:18:37.000Z',
      classification: 'Already Submitted Elsewhere',
    });
    expect(contactFor(ctx, VENDOR_A)?.declineDetectedAt).toBe('2026-11-10T23:18:37.000Z');
  });

  it('control: a recruiter email asking "are you interested?" flags nothing', () => {
    const ctx = setup();
    ingest(ctx, { id: 'tp-in', subject: 'FW: Platform Engineer - Acme Bank', textBody: tpInbound.replace('Thanks for your time today.', 'Not interested? No problem.'), receivedAt: '2026-10-26T17:58:00.000Z' });
    expect(contactFor(ctx, TP_RECRUITER)?.declineDetectedAt).toBeNull();
  });
});

describe('AC5: a bulk re-send of the same job is not a reply', () => {
  function withQuestion() {
    const ctx = setup();
    ingest(ctx, {
      id: 'c-question',
      subject: 'FW: RE: Solutions Architect - Initech - Remote',
      textBody: vendorBQuestionForward,
      receivedAt: '2026-11-13T16:52:00.000Z',
    });
    expect(contactFor(ctx, VENDOR_B)?.lastContactDate).toBe('2026-11-13');
    return ctx;
  }

  it('logs the re-send but leaves the clock at your question (you were Bcc, same job subject)', () => {
    const ctx = withQuestion();
    ingest(ctx, {
      id: 'c-resend',
      subject: 'FW: Solutions Architect - Initech - Remote',
      textBody: vendorBMassResend,
      receivedAt: '2026-11-23T17:45:00.000Z',
    });
    const vendor = contactFor(ctx, VENDOR_B)!;
    expect(directionsFor(ctx, vendor.id)).toEqual(['outbound', 'inbound']);
    expect(vendor.lastContactDate).toBe('2026-11-13');
  });

  it('control: a real reply addressed to you still restarts the clock', () => {
    const ctx = withQuestion();
    ingest(ctx, {
      id: 'c-reply',
      subject: 'FW: RE: Solutions Architect - Initech - Remote',
      textBody: vendorBRealReply,
      receivedAt: '2026-11-23T17:45:00.000Z',
    });
    expect(contactFor(ctx, VENDOR_B)?.lastContactDate).toBe('2026-11-23');
  });

  it('control: a reply whose To: is a bare display name still counts (can\'t tell who was addressed)', () => {
    const ctx = withQuestion();
    ingest(ctx, {
      id: 'c-name-only',
      subject: 'FW: RE: Solutions Architect - Initech - Remote',
      textBody: vendorBRealReply
        .replace(`To: Jordan Pike <${SEEKER}>`, `To: Jordan Pike\nCc: Desk <desk@vendor-b.example>`),
      receivedAt: '2026-11-23T17:45:00.000Z',
    });
    expect(contactFor(ctx, VENDOR_B)?.lastContactDate).toBe('2026-11-23');
  });

  it('control: a Bcc message on a NEW subject still counts', () => {
    const ctx = withQuestion();
    ingest(ctx, {
      id: 'c-new-job',
      subject: 'FW: Data Architect - Hooli - Remote',
      textBody: vendorBMassResend.replace(/Solutions Architect - Initech - Remote/g, 'Data Architect - Hooli - Remote'),
      receivedAt: '2026-11-23T17:45:00.000Z',
    });
    expect(contactFor(ctx, VENDOR_B)?.lastContactDate).toBe('2026-11-23');
  });
});
