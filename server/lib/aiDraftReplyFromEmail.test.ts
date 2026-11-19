/** @jest-environment node */
import { emailAutomationAuditLog } from '../db/schema.js';
import { outlookOutboundTopNoNote } from './__fixtures__/outlookOutboundTopMessage.js';
import { AI_DRAFTS_PER_USER_PER_DAY, aiDraftReplyFromEmail } from './emailAutomationService.js';
import { createTestDb, seedInboundEmail, seedTestUser } from './testDb.js';

const saved = { ...process.env };
const FORWARDER = 'steve@terapak.com';

// Answers every OpenAI call with a fixed draft and keeps what was sent.
function mockOpenAi() {
  const prompts: Array<Record<string, unknown>> = [];
  global.fetch = jest.fn(async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}') as { messages: Array<{ content: string }> };
    prompts.push(JSON.parse(body.messages[1].content) as Record<string, unknown>);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Hi there,\n\nFollowing up.\n\nSteve' } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
      text: async () => '',
    };
  }) as unknown as typeof fetch;
  return prompts;
}

function payload(textBody: string, fromName = 'Steve Terapak') {
  return JSON.stringify({ TextBody: textBody, FromName: fromName });
}

beforeEach(() => {
  process.env = { ...saved, OPENAI_API_KEY: 'sk-test' };
  delete process.env.AI_PROVIDER;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  jest.restoreAllMocks();
});

describe('aiDraftReplyFromEmail', () => {
  it('returns null for an email the user does not own', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const emailId = seedInboundEmail(db, { toEmail: 'someone-else@example.com' });
    expect(await aiDraftReplyFromEmail(db, userId, emailId)).toBeNull();
  });

  it('replies to the sender of a direct email', async () => {
    const prompts = mockOpenAi();
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com', name: 'Sam Seeker' });
    const emailId = seedInboundEmail(db, {
      fromEmail: 'nick@afresh.example',
      toEmail: 'seeker@example.com',
      payload: payload('Hi Sam, are you free for an interview?', 'Nick Gasparro'),
    });

    const result = await aiDraftReplyFromEmail(db, userId, emailId);

    expect(result?.source).toBe('llm');
    expect(prompts[0].replyTo).toEqual({ name: 'Nick Gasparro', email: 'nick@afresh.example' });
    expect(prompts[0].lastMessageFromUser).toBe(false);
    expect(prompts[0].userName).toBe('Sam Seeker');
  });

  it('writes a follow-up to the counterparty when the user wrote the newest message', async () => {
    const prompts = mockOpenAi();
    const db = createTestDb();
    const userId = seedTestUser(db, { email: FORWARDER });
    const emailId = seedInboundEmail(db, {
      subject: 'FW: Solution Architect !! Location:  Example City !!',
      fromEmail: FORWARDER,
      toEmail: FORWARDER,
      payload: payload(outlookOutboundTopNoNote),
    });

    await aiDraftReplyFromEmail(db, userId, emailId);

    const replyTo = prompts[0].replyTo as { email: string };
    expect(replyTo.email).toBe('ravi.kumar@acmestaffing.example');
    expect(prompts[0].lastMessageFromUser).toBe(true);
  });

  it('never addresses the user when the forward is only their own sent message', async () => {
    const prompts = mockOpenAi();
    const db = createTestDb();
    const userId = seedTestUser(db, { email: FORWARDER });
    const body = `________________________________
From: Steve Terapak <steve@terapak.com>
Sent: Tuesday, 10 November 2026 07:03:47
To: Nick Gasparro <nick@afresh.example>
Subject: Afresh Interview Request

Hi Nick, just checking in on next steps.

Steve`;
    const emailId = seedInboundEmail(db, {
      subject: 'Fw: Afresh Interview Request',
      fromEmail: FORWARDER,
      toEmail: FORWARDER,
      payload: payload(body),
    });

    await aiDraftReplyFromEmail(db, userId, emailId);

    // The parser keeps only the address for To:; the prompt falls back to
    // the recruiter name.
    expect(prompts[0].replyTo).toEqual({ name: null, email: 'nick@afresh.example' });
    expect(prompts[0].lastMessageFromUser).toBe(true);
  });

  it('never addresses the user for an email they sent the inbox directly', async () => {
    const prompts = mockOpenAi();
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com', name: 'Sam Seeker' });
    const emailId = seedInboundEmail(db, {
      subject: 'Note to self: follow up with Afresh',
      fromEmail: 'Sam Seeker <seeker@example.com>',
      toEmail: 'jobinfo@jobs.terapak.com',
      payload: payload('Remember to follow up with Nick.', 'Sam Seeker'),
    });

    await aiDraftReplyFromEmail(db, userId, emailId);

    expect(prompts[0].replyTo).toEqual({ name: null, email: null });
    expect(prompts[0].lastMessageFromUser).toBe(true);
  });

  // Fable re-review: a recruiter's direct reply that quotes the user also
  // parses as "forwarded"; the recruiter must stay the recipient.
  it.each([
    ['To only', ''],
    ['with a Cc', 'Cc: Boss <boss@afresh.example>\n'],
  ])('replies to the recruiter of a direct reply that quotes the user (%s)', async (_label, cc) => {
    const prompts = mockOpenAi();
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com', name: 'Sam Seeker' });
    const body = `Hi Sam, Thursday at 2pm works. See you then.

Nick

________________________________
From: Sam Seeker <seeker@example.com>
Sent: Tuesday, 10 November 2026 07:03:47
To: Nick Gasparro <nick@afresh.example>
${cc}Subject: Afresh Interview Request

Hi Nick, I'm free Thursday afternoon.

Sam`;
    const emailId = seedInboundEmail(db, {
      subject: 'RE: Afresh Interview Request',
      fromEmail: 'nick@afresh.example',
      toEmail: 'seeker@example.com',
      payload: payload(body, 'Nick Gasparro'),
    });

    await aiDraftReplyFromEmail(db, userId, emailId);

    expect(prompts[0].replyTo).toEqual({ name: 'Nick Gasparro', email: 'nick@afresh.example' });
    expect(prompts[0].lastMessageFromUser).toBe(false);
  });

  it.each([
    ['the inbound address', 'Jobs Inbox <jobinfo@jobs.terapak.com>', null, null],
    ['a name only', 'Nick Gasparro', 'Nick Gasparro', null],
    ['the user and then Nick', 'Steve <steve@terapak.com>; Nick <nick@afresh.example>', null, 'nick@afresh.example'],
  ])('never writes to the user or the inbox when the forwarded To: is %s', async (_label, to, name, email) => {
    const prompts = mockOpenAi();
    const db = createTestDb();
    const userId = seedTestUser(db, { email: FORWARDER });
    const body = `________________________________
From: Steve Terapak <steve@terapak.com>
Sent: Tuesday, 10 November 2026 07:03:47
To: ${to}
Subject: Afresh Interview Request

Hi, just checking in on next steps.`;
    const emailId = seedInboundEmail(db, {
      subject: 'Fw: Afresh Interview Request',
      fromEmail: FORWARDER,
      toEmail: 'jobinfo@jobs.terapak.com',
      payload: payload(body),
    });

    await aiDraftReplyFromEmail(db, userId, emailId);

    expect(prompts[0].replyTo).toEqual({ name, email });
    expect(prompts[0].lastMessageFromUser).toBe(true);
  });

  it('uses the template, without calling the AI, once the user hits the daily limit', async () => {
    const prompts = mockOpenAi();
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const emailId = seedInboundEmail(db, { toEmail: 'seeker@example.com' });

    for (let i = 0; i < AI_DRAFTS_PER_USER_PER_DAY; i += 1) {
      expect((await aiDraftReplyFromEmail(db, userId, emailId))?.source).toBe('llm');
    }
    const limited = await aiDraftReplyFromEmail(db, userId, emailId);

    expect(limited?.source).toBe('limited');
    expect(limited?.draft).toContain('Hi');
    expect(prompts).toHaveLength(AI_DRAFTS_PER_USER_PER_DAY);
    expect(db.select().from(emailAutomationAuditLog).all()).toHaveLength(
      AI_DRAFTS_PER_USER_PER_DAY + 1,
    );
  });

  it('holds the limit when clicks arrive in parallel', async () => {
    const prompts = mockOpenAi();
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const emailId = seedInboundEmail(db, { toEmail: 'seeker@example.com' });

    const results = await Promise.all(
      Array.from({ length: AI_DRAFTS_PER_USER_PER_DAY + 5 }, () =>
        aiDraftReplyFromEmail(db, userId, emailId),
      ),
    );

    expect(prompts).toHaveLength(AI_DRAFTS_PER_USER_PER_DAY);
    expect(results.filter((r) => r?.source === 'limited')).toHaveLength(5);
  });

  it('counts only AI attempts toward the limit', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const emailId = seedInboundEmail(db, { toEmail: 'seeker@example.com' });

    // No key: every click is a template, and none of them count.
    delete process.env.OPENAI_API_KEY;
    for (let i = 0; i < AI_DRAFTS_PER_USER_PER_DAY + 5; i += 1) {
      expect((await aiDraftReplyFromEmail(db, userId, emailId))?.source).toBe('template');
    }

    process.env.OPENAI_API_KEY = 'sk-test';
    mockOpenAi();
    expect((await aiDraftReplyFromEmail(db, userId, emailId))?.source).toBe('llm');
  });

  it('does not extend the lockout with clicks made while limited', async () => {
    const prompts = mockOpenAi();
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const emailId = seedInboundEmail(db, { toEmail: 'seeker@example.com' });
    for (let i = 0; i < AI_DRAFTS_PER_USER_PER_DAY + 10; i += 1) {
      await aiDraftReplyFromEmail(db, userId, emailId);
    }
    const marked = db
      .select()
      .from(emailAutomationAuditLog)
      .all()
      .filter((r) => r.detailsJson.includes('ai_draft_button'));
    expect(marked).toHaveLength(AI_DRAFTS_PER_USER_PER_DAY);
    expect(prompts).toHaveLength(AI_DRAFTS_PER_USER_PER_DAY);
  });
});
