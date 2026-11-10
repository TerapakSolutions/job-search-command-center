/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { inboundEmails } from '../db/schema.js';
import { classifyInboundEmailForUser } from './emailClassificationService.js';
import * as engine from './emailClassificationEngine.js';
import {
  classificationInputFromEmail,
  parseForwardedEmail,
} from './emailForwardedParser.js';
import { createTestDb, seedInboundEmail, seedTestUser } from './testDb.js';

jest.mock('./emailClassificationEngine.js', () => ({
  classifyInboundEmailWithLlm: jest.fn().mockResolvedValue(null),
  classifyInboundEmailWithRules: jest.requireActual('./emailClassificationEngine.js')
    .classifyInboundEmailWithRules,
}));
void engine;

// Shape of a real Outlook forward (prod, 2026-11-10): the forwarder's
// signature, then their own message whose From: line carries only a display
// name. People and domains replaced.
const BODY = `

Steve Terapak
555-0100
terapak.com<https://www.terapak.com>



________________________________
From: Steve Terapak
Sent: Tuesday, November 10, 2026 8:19 AM
To: dana@staffing.example <dana@staffing.example>
Subject: Platform Lead – next steps

Hi Dana,

Checking in on next steps for the Platform Lead role. I remain very interested.

Best,
Steve`;

const SUBJECT = 'Fw: Platform Lead – next steps';
const FORWARDER = 'steve@terapak.com';

describe('Outlook top message with a name-only From: header', () => {
  it('is the forwarder own message when the name matches their display name', () => {
    const meta = parseForwardedEmail(SUBJECT, FORWARDER, BODY, 'Steve Terapak');
    expect(meta.topMessageFromForwarder).toBe(true);
    // No quoted counterparty, so the recipient is the counterparty.
    expect(meta.originalSenderEmail).toBe('dana@staffing.example');
    expect(meta.originalBody).toMatch(/^Hi Dana,/);
  });

  it('matches the display name case-insensitively', () => {
    expect(parseForwardedEmail(SUBJECT, FORWARDER, BODY, '  steve terapak ').topMessageFromForwarder).toBe(true);
  });

  it('control: without the display name it is not recognised (behaviour before this change)', () => {
    expect(parseForwardedEmail(SUBJECT, FORWARDER, BODY).topMessageFromForwarder).toBe(false);
  });

  it('control: a different name is not the forwarder', () => {
    expect(parseForwardedEmail(SUBJECT, FORWARDER, BODY, 'Someone Else').topMessageFromForwarder).toBe(false);
  });

  it('classificationInputFromEmail passes the display name through', () => {
    const input = classificationInputFromEmail({
      subject: SUBJECT,
      fromEmail: FORWARDER,
      fromName: 'Steve Terapak',
      textBody: BODY,
    });
    expect(input.forwardMetadata.topMessageFromForwarder).toBe(true);
    expect(input.fromEmail).toBe(FORWARDER);
  });

  it('classifying a stored email reads the display name from its payload', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: FORWARDER });
    const id = seedInboundEmail(db, {
      id: 'email-name-only',
      fromEmail: FORWARDER,
      toEmail: 'jobs@inbound.example',
      subject: SUBJECT,
      payload: JSON.stringify({ TextBody: BODY, FromName: 'Steve Terapak', From: FORWARDER }),
    });
    const result = await classifyInboundEmailForUser(db, userId, id, { force: true });
    expect(result?.requiresResponse).toBe(false);
    const row = db.select().from(inboundEmails).where(eq(inboundEmails.id, id)).all()[0];
    expect(row.originalSenderEmail).toBe('dana@staffing.example');
  });
});
