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

    const replyTo = prompts[0].replyTo as { name: string | null; email: string | null };
    expect(replyTo.email).not.toBe(FORWARDER);
    expect(replyTo.name).not.toBe('Steve Terapak');
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
});
