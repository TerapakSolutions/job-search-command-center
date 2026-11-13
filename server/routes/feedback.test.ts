/** @jest-environment node */
import http from 'node:http';
import { createApp } from '../app.js';
import { feedback } from '../db/schema.js';
import { createSessionToken } from '../lib/session.js';
import { createTestDb, seedTestUser } from '../lib/testDb.js';

type TestDb = ReturnType<typeof createTestDb>;

const ENV_KEYS = [
  'FEEDBACK_ENABLED',
  'FEEDBACK_SLACK_WEBHOOK_URL',
  'FEEDBACK_EMAIL_TO',
  'POSTMARK_SERVER_TOKEN',
  'POSTMARK_FROM_EMAIL',
] as const;

const SLACK_URL = 'https://hooks.slack.test/services/T/B/X';
const realFetch = globalThis.fetch;

/** Local requests reach the test server; Slack and Postmark get `external`. */
function stubExternal(external: (url: string) => Promise<Response>) {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
    return external(url);
  });
}

function externalCalls(spy: jest.SpyInstance): string[] {
  return spy.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => !u.startsWith('http://127.0.0.1'));
}

async function startServer(db: TestDb) {
  process.env.SESSION_SECRET = 'test-session-secret-for-feedback';
  const server = http.createServer(createApp(db));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function cookieFor(userId: string): string {
  return `session=${encodeURIComponent(createSessionToken(userId))}`;
}

async function post(baseUrl: string, body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: JSON.stringify(body),
  });
}

function rows(db: TestDb) {
  return db.select().from(feedback).all();
}

describe('POST /api/feedback', () => {
  const saved: Record<string, string | undefined> = {};
  let db: TestDb;
  let userId: string;
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeEach(async () => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.FEEDBACK_ENABLED = 'true';
    db = createTestDb();
    userId = seedTestUser(db, { id: 'user-jane', email: 'jane@example.com', name: 'Jane Doe' });
    server = await startServer(db);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await server.close();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('the migration creates the feedback table with every column', () => {
    const cols = (
      db.$client.prepare(`PRAGMA table_info('feedback')`).all() as Array<{ name: string; notnull: number }>
    ).map((c) => c.name);
    expect(cols).toEqual([
      'id',
      'user_id',
      'user_email',
      'message',
      'page_url',
      'user_agent',
      'app_version',
      'created_at',
      'slack_notified_at',
      'slack_error',
      'email_notified_at',
      'email_error',
    ]);
  });

  it('answers 401 when signed out, and saves nothing', async () => {
    const res = await post(server.baseUrl, { message: 'broken', pageUrl: '/today' });
    expect(res.status).toBe(401);
    expect(rows(db)).toHaveLength(0);
  });

  it('answers 404 when FEEDBACK_ENABLED is not "true", and saves nothing', async () => {
    for (const value of [undefined, 'false', '1', 'TRUE']) {
      if (value === undefined) delete process.env.FEEDBACK_ENABLED;
      else process.env.FEEDBACK_ENABLED = value;
      const res = await post(server.baseUrl, { message: 'broken', pageUrl: '/today' }, cookieFor(userId));
      expect(res.status).toBe(404);
    }
    expect(rows(db)).toHaveLength(0);
  });

  it('saves the report with identity from the session and answers 201', async () => {
    const res = await post(
      server.baseUrl,
      { message: '  The Today page is blank  ', pageUrl: 'https://jobsearch.example.com/today' },
      cookieFor(userId),
      { 'User-Agent': 'TestBrowser/1.0' },
    );
    expect(res.status).toBe(201);
    const all = rows(db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      userId: 'user-jane',
      userEmail: 'jane@example.com',
      message: 'The Today page is blank',
      pageUrl: 'https://jobsearch.example.com/today',
      userAgent: 'TestBrowser/1.0',
      appVersion: null,
      slackNotifiedAt: null,
      slackError: null,
      emailNotifiedAt: null,
      emailError: null,
    });
    expect(all[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rejects a body that tries to set userId or email, and saves nothing', async () => {
    seedTestUser(db, { id: 'user-other', email: 'other@example.com' });
    for (const extra of [{ userId: 'user-other' }, { email: 'other@example.com' }, { userEmail: 'other@example.com' }]) {
      const res = await post(server.baseUrl, { message: 'hi', pageUrl: '/today', ...extra }, cookieFor(userId));
      expect(res.status).toBe(400);
    }
    expect(rows(db)).toHaveLength(0);
  });

  it('enforces the length caps', async () => {
    const cookie = cookieFor(userId);
    const bad = [
      { message: '', pageUrl: '/today' },
      { message: '    ', pageUrl: '/today' },
      { message: 'x'.repeat(4001), pageUrl: '/today' },
      { message: 'ok', pageUrl: '/' + 'p'.repeat(500) },
      { message: 'ok', pageUrl: '/today', appVersion: 'v'.repeat(101) },
      { message: 42, pageUrl: '/today' },
      { pageUrl: '/today' },
      { message: 'ok', pageUrl: 7 },
    ];
    for (const body of bad) {
      const res = await post(server.baseUrl, body, cookie);
      expect({ body, status: res.status }).toEqual({ body, status: 400 });
    }
    expect(rows(db)).toHaveLength(0);

    const atCap = await post(server.baseUrl, { message: 'x'.repeat(4000), pageUrl: '/' + 'p'.repeat(499) }, cookie);
    expect(atCap.status).toBe(201);

    const longUa = await post(server.baseUrl, { message: 'ua', pageUrl: '/today' }, cookie, {
      'User-Agent': 'U'.repeat(2000),
    });
    expect(longUa.status).toBe(201);
    const uaRow = rows(db).find((r) => r.message === 'ua');
    expect(uaRow?.userAgent).toHaveLength(500);
  });

  it('allows 5 reports per user per hour, then answers 429 without saving', async () => {
    const cookie = cookieFor(userId);
    for (let i = 0; i < 5; i += 1) {
      const res = await post(server.baseUrl, { message: `report ${i}`, pageUrl: '/today' }, cookie);
      expect(res.status).toBe(201);
    }
    const sixth = await post(server.baseUrl, { message: 'report 6', pageUrl: '/today' }, cookie);
    expect(sixth.status).toBe(429);
    expect(rows(db)).toHaveLength(5);

    // Another user has their own budget.
    const other = seedTestUser(db, { id: 'user-other', email: 'other@example.com' });
    const res = await post(server.baseUrl, { message: 'mine', pageUrl: '/today' }, cookieFor(other));
    expect(res.status).toBe(201);
  });

  it('skips both notifiers when unset: no outbound call, nothing recorded', async () => {
    const spy = stubExternal(async () => new Response('ok'));
    const res = await post(server.baseUrl, { message: 'hi', pageUrl: '/today' }, cookieFor(userId));
    expect(res.status).toBe(201);
    expect(externalCalls(spy)).toEqual([]);
    expect(rows(db)[0]).toMatchObject({ slackNotifiedAt: null, slackError: null, emailNotifiedAt: null, emailError: null });
  });

  it('records each notifier result on the row; a failing one still answers 201', async () => {
    process.env.FEEDBACK_SLACK_WEBHOOK_URL = SLACK_URL;
    process.env.FEEDBACK_EMAIL_TO = 'feedback@example.com';
    process.env.POSTMARK_SERVER_TOKEN = 'test-token';
    process.env.POSTMARK_FROM_EMAIL = 'app@example.com';
    const spy = stubExternal(async (url) => {
      if (url === SLACK_URL) return new Response('ok', { status: 200 });
      throw new Error('postmark unreachable');
    });

    const res = await post(server.baseUrl, { message: 'Hey <!channel>', pageUrl: '/today' }, cookieFor(userId));
    expect(res.status).toBe(201);
    expect(externalCalls(spy).sort()).toEqual(['https://api.postmarkapp.com/email', SLACK_URL]);

    const row = rows(db)[0];
    expect(row.slackNotifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.slackError).toBeNull();
    expect(row.emailNotifiedAt).toBeNull();
    expect(row.emailError).toContain('postmark unreachable');

    const slackBody = JSON.parse(String(spy.mock.calls.find((c) => String(c[0]) === SLACK_URL)?.[1]?.body)) as {
      text: string;
    };
    expect(slackBody.text).toContain('Hey &lt;!channel&gt;');
    expect(slackBody.text).not.toContain('<!channel>');
  });

  it('records a Slack failure and still answers 201', async () => {
    process.env.FEEDBACK_SLACK_WEBHOOK_URL = SLACK_URL;
    stubExternal(async () => new Response('invalid_token', { status: 403 }));
    const res = await post(server.baseUrl, { message: 'hi', pageUrl: '/today' }, cookieFor(userId));
    expect(res.status).toBe(201);
    const row = rows(db)[0];
    expect(row.slackNotifiedAt).toBeNull();
    expect(row.slackError).toContain('403');
  });
});
