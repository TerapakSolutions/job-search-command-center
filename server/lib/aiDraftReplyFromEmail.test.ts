/** @jest-environment node */
import { eq } from 'drizzle-orm';
import {
  emailApplicationLinks,
  emailAutomationAuditLog,
  inboundEmails,
  interviews,
} from '../db/schema.js';
import { outlookOutboundTopNoNote } from './__fixtures__/outlookOutboundTopMessage.js';
import {
  AI_DRAFTS_PER_USER_PER_DAY,
  aiDraftReplyFromEmail,
  setEmailApplicationLink,
} from './emailAutomationService.js';
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';

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

  // Fable second re-review: the user's forward of a recruiter's email must
  // reply to the recruiter whatever the subject prefix.
  it.each([['Fw: Afresh Interview Request'], ['WG: Afresh Interview Request'], ['[EXT] Fwd: Afresh'], ['Afresh - please read']])(
    'replies to the recruiter of a forward the user sent with subject %s',
    async (subject) => {
      const prompts = mockOpenAi();
      const db = createTestDb();
      const userId = seedTestUser(db, { email: FORWARDER });
      const body = `________________________________
From: Nick Gasparro <nick@afresh.example>
Sent: Tuesday, 10 November 2026 07:03:47
To: Steve Terapak <steve@terapak.com>
Subject: Afresh Interview Request

Hi Steve, are you free for an interview next week?

Nick`;
      const emailId = seedInboundEmail(db, {
        subject,
        fromEmail: FORWARDER,
        toEmail: 'jobinfo@jobs.terapak.com',
        payload: payload(body),
      });

      await aiDraftReplyFromEmail(db, userId, emailId);

      expect((prompts[0].replyTo as { email: string }).email).toBe('nick@afresh.example');
      expect(prompts[0].lastMessageFromUser).toBe(false);
    },
  );

  it('replies to a recruiter who sends the user an FW: of the user\'s own message', async () => {
    const prompts = mockOpenAi();
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const body = `Sam, passing this along with my notes: looks good.

________________________________
From: Sam Seeker <seeker@example.com>
Sent: Tuesday, 10 November 2026 07:03:47
To: Nick Gasparro <nick@afresh.example>
Subject: Afresh Interview Request

Hi Nick, I'm free Thursday afternoon.`;
    const emailId = seedInboundEmail(db, {
      subject: 'FW: Afresh Interview Request',
      fromEmail: 'nick@afresh.example',
      toEmail: 'seeker@example.com',
      payload: payload(body, 'Nick Gasparro'),
    });

    await aiDraftReplyFromEmail(db, userId, emailId);

    expect(prompts[0].replyTo).toEqual({ name: 'Nick Gasparro', email: 'nick@afresh.example' });
    expect(prompts[0].lastMessageFromUser).toBe(false);
  });

  it('replies to a recruiter who forwards the user a third party\'s message', async () => {
    const prompts = mockOpenAi();
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const body = `Sam, see the hiring manager's note below.

________________________________
From: Hannah Manager <hannah@afresh.example>
Sent: Tuesday, 10 November 2026 07:03:47
To: Nick Gasparro <nick@afresh.example>
Subject: Afresh Interview Request

Nick, can Sam do Thursday?`;
    const emailId = seedInboundEmail(db, {
      subject: 'FW: Afresh Interview Request',
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

  describe('linked application context (#125)', () => {
    const NOW = new Date('2026-11-19T18:00:00.000Z');

    function seedScreenedApplication(db: ReturnType<typeof createTestDb>, userId: string) {
      const appId = seedApplication(db, userId, {
        company: 'Afresh',
        roleTitle: 'Senior Engineering Manager',
        status: 'recruiter_screen',
        agency: 'Code Talent',
        submittedDate: '2026-11-16',
        dateApplied: '2026-11-09',
      });
      db.insert(interviews)
        .values({
          id: 'int-1',
          userId,
          applicationId: appId,
          scheduledAt: '2026-11-13T17:15:00.000Z',
          type: 'video',
          location: '',
          notes: 'private note',
          createdAt: '2026-11-11T00:00:00.000Z',
          updatedAt: '2026-11-11T00:00:00.000Z',
        })
        .run();
      return appId;
    }

    it('sends where the linked application stands, with past interviews marked', async () => {
      const prompts = mockOpenAi();
      const db = createTestDb();
      const userId = seedTestUser(db, { email: 'seeker@example.com' });
      const emailId = seedInboundEmail(db, {
        fromEmail: 'nick@afresh.example',
        toEmail: 'seeker@example.com',
        receivedAt: '2026-11-11T06:33:06.000Z',
        payload: payload('Please book a screen with the Calendly link.', 'Nick Gasparro'),
      });
      const appId = seedScreenedApplication(db, userId);
      expect(setEmailApplicationLink(db, userId, emailId, appId)).toBe(true);

      await aiDraftReplyFromEmail(db, userId, emailId, NOW);

      expect(prompts[0].today).toBe('2026-11-19');
      expect(prompts[0].emailDate).toBe('2026-11-10');
      expect(prompts[0].application).toEqual({
        stage: 'Recruiter Screen',
        agency: 'Code Talent',
        submittedDate: '2026-11-16',
        dateApplied: '2026-11-09',
        interviews: [{ date: '2026-11-13', type: 'video', past: true }],
        movedOnSinceEmail: true,
      });
      // Notes stay out of the prompt.
      expect(JSON.stringify(prompts[0])).not.toContain('private note');
    });

    it('marks an interview later today as upcoming', async () => {
      const prompts = mockOpenAi();
      const db = createTestDb();
      const userId = seedTestUser(db, { email: 'seeker@example.com' });
      const emailId = seedInboundEmail(db, { toEmail: 'seeker@example.com' });
      const appId = seedApplication(db, userId, { status: 'interviewing' });
      db.insert(interviews)
        .values({
          id: 'int-2',
          userId,
          applicationId: appId,
          scheduledAt: '2026-11-19T22:00:00.000Z',
          type: 'video',
          location: '',
          notes: '',
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        })
        .run();
      setEmailApplicationLink(db, userId, emailId, appId);

      await aiDraftReplyFromEmail(db, userId, emailId, NOW);

      const app = prompts[0].application as { interviews: Array<{ past: boolean }> };
      expect(app.interviews).toEqual([{ date: '2026-11-19', type: 'video', past: false }]);
    });

    it('falls back to the application interview date when no interview rows exist', async () => {
      const prompts = mockOpenAi();
      const db = createTestDb();
      const userId = seedTestUser(db, { email: 'seeker@example.com' });
      const emailId = seedInboundEmail(db, { toEmail: 'seeker@example.com' });
      const appId = seedApplication(db, userId, { status: 'recruiter_screen', interviewDate: '2026-11-13' });
      setEmailApplicationLink(db, userId, emailId, appId);

      await aiDraftReplyFromEmail(db, userId, emailId, NOW);

      const app = prompts[0].application as { interviews: unknown };
      expect(app.interviews).toEqual([{ date: '2026-11-13', type: 'interview', past: true }]);
    });

    it('sends no application when the email is not linked', async () => {
      const prompts = mockOpenAi();
      const db = createTestDb();
      const userId = seedTestUser(db, { email: 'seeker@example.com' });
      seedApplication(db, userId);
      const emailId = seedInboundEmail(db, { toEmail: 'seeker@example.com' });

      await aiDraftReplyFromEmail(db, userId, emailId, NOW);

      expect(prompts[0].application).toBeNull();
      expect(prompts[0].today).toBe('2026-11-19');
    });
  
    it('keeps a current ask current when the email came after the past interview', async () => {
      const prompts = mockOpenAi();
      const db = createTestDb();
      const userId = seedTestUser(db, { email: 'seeker@example.com' });
      const emailId = seedInboundEmail(db, {
        fromEmail: 'nick@afresh.example',
        toEmail: 'seeker@example.com',
        receivedAt: '2026-11-18T17:00:00.000Z',
        payload: payload('The client wants to meet. Send me a few times.', 'Nick Gasparro'),
      });
      const appId = seedScreenedApplication(db, userId);
      setEmailApplicationLink(db, userId, emailId, appId);

      await aiDraftReplyFromEmail(db, userId, emailId, NOW);

      const app = prompts[0].application as { movedOnSinceEmail: boolean };
      expect(prompts[0].emailDate).toBe('2026-11-18');
      expect(app.movedOnSinceEmail).toBe(false);
    });

    it('treats an email sent the day of the interview as current', async () => {
      const prompts = mockOpenAi();
      const db = createTestDb();
      const userId = seedTestUser(db, { email: 'seeker@example.com' });
      const emailId = seedInboundEmail(db, {
        toEmail: 'seeker@example.com',
        receivedAt: '2026-11-13T20:00:00.000Z',
      });
      const appId = seedApplication(db, userId, { status: 'recruiter_screen', interviewDate: '2026-11-13' });
      setEmailApplicationLink(db, userId, emailId, appId);

      await aiDraftReplyFromEmail(db, userId, emailId, NOW);

      expect((prompts[0].application as { movedOnSinceEmail: boolean }).movedOnSinceEmail).toBe(false);
    });

    it("dates the user's own forward by the original message", async () => {
      const prompts = mockOpenAi();
      const db = createTestDb();
      const userId = seedTestUser(db, { email: FORWARDER });
      const body = `________________________________
From: Nick Gasparro <nick@afresh.example>
Sent: Tuesday, 10 November 2026 22:33:00
To: Steve Terapak <steve@terapak.com>
Subject: Afresh Interview Request

Please book a screen with the Calendly link.`;
      const emailId = seedInboundEmail(db, {
        subject: 'Fw: Afresh Interview Request',
        fromEmail: FORWARDER,
        toEmail: FORWARDER,
        receivedAt: '2026-11-19T16:00:00.000Z',
        payload: payload(body),
      });
      db.update(inboundEmails)
        .set({ originalSentAt: '2026-11-11T06:33:00.000Z' })
        .where(eq(inboundEmails.id, emailId))
        .run();

      await aiDraftReplyFromEmail(db, userId, emailId, NOW);

      expect(prompts[0].emailDate).toBe('2026-11-10');
    });

    it("dates a recruiter's reply by when it arrived, not the message it quotes", async () => {
      const prompts = mockOpenAi();
      const db = createTestDb();
      const userId = seedTestUser(db, { email: 'seeker@example.com' });
      const body = `Thanks Sam, the client wants to meet. Send me a few times.

From: Sam Seeker <seeker@example.com>
Sent: Monday, 2 November 2026 09:00:00
To: Nick Gasparro <nick@afresh.example>
Subject: RE: Afresh

Checking in on next steps.`;
      const emailId = seedInboundEmail(db, {
        fromEmail: 'nick@afresh.example',
        toEmail: 'seeker@example.com',
        receivedAt: '2026-11-18T17:00:00.000Z',
        payload: payload(body, 'Nick Gasparro'),
      });
      db.update(inboundEmails)
        .set({ originalSentAt: '2026-11-02T17:00:00.000Z' })
        .where(eq(inboundEmails.id, emailId))
        .run();

      await aiDraftReplyFromEmail(db, userId, emailId, NOW);

      expect(prompts[0].emailDate).toBe('2026-11-18');
    });

    it("reads a date-only interview as that calendar day", async () => {
      const prompts = mockOpenAi();
      const db = createTestDb();
      const userId = seedTestUser(db, { email: 'seeker@example.com' });
      const emailId = seedInboundEmail(db, { toEmail: 'seeker@example.com' });
      const appId = seedApplication(db, userId, { status: 'interviewing' });
      db.insert(interviews)
        .values({
          id: 'int-3',
          userId,
          applicationId: appId,
          scheduledAt: '2026-11-19',
          type: 'video',
          location: '',
          notes: '',
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        })
        .run();
      setEmailApplicationLink(db, userId, emailId, appId);

      await aiDraftReplyFromEmail(db, userId, emailId, NOW);

      const app = prompts[0].application as { interviews: unknown };
      expect(app.interviews).toEqual([{ date: '2026-11-19', type: 'video', past: false }]);
    });

    it("sends nothing from an application the user doesn't own", async () => {
      const prompts = mockOpenAi();
      const db = createTestDb();
      const userId = seedTestUser(db, { email: 'seeker@example.com' });
      const otherId = seedTestUser(db, { id: 'other-user', email: 'other@example.com' });
      const otherApp = seedApplication(db, otherId, { id: 'app-other', agency: 'Secret Agency' });
      const emailId = seedInboundEmail(db, { toEmail: 'seeker@example.com' });
      // A stray link row the API would never write.
      db.insert(emailApplicationLinks)
        .values({
          id: 'link-x',
          userId,
          inboundEmailId: emailId,
          applicationId: otherApp,
          createdAt: NOW.toISOString(),
        })
        .run();

      await aiDraftReplyFromEmail(db, userId, emailId, NOW);

      expect(prompts[0].application).toBeNull();
      expect(JSON.stringify(prompts[0])).not.toContain('Secret Agency');
    });
  
    it('counts a submission after the email, but not one dated in the future', async () => {
      const prompts = mockOpenAi();
      const db = createTestDb();
      const userId = seedTestUser(db, { email: 'seeker@example.com' });
      const first = seedInboundEmail(db, { toEmail: 'seeker@example.com', receivedAt: '2026-11-11T18:00:00.000Z' });
      const second = seedInboundEmail(db, { toEmail: 'seeker@example.com', receivedAt: '2026-11-11T18:00:00.000Z' });
      const submitted = seedApplication(db, userId, { id: 'app-s', submittedDate: '2026-11-16' });
      const future = seedApplication(db, userId, { id: 'app-f', submittedDate: '2026-11-25' });
      setEmailApplicationLink(db, userId, first, submitted);
      setEmailApplicationLink(db, userId, second, future);

      await aiDraftReplyFromEmail(db, userId, first, NOW);
      await aiDraftReplyFromEmail(db, userId, second, NOW);

      const flags = prompts.map((p) => (p.application as { movedOnSinceEmail: boolean }).movedOnSinceEmail);
      expect(flags).toEqual([true, false]);
    });
  });
});
