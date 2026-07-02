/** @jest-environment node */
import http from 'node:http';
import { createApp } from '../app.js';
import { inboundEmails } from '../db/schema.js';
import {
  resetInboundEmailProcessingScheduler,
  setInboundEmailProcessingScheduler,
} from '../lib/inboundEmailProcessingQueue.js';
import { createTestDb, seedTestUser } from '../lib/testDb.js';

type TestDb = ReturnType<typeof createTestDb>;

function startServer(db: TestDb) {
  const app = createApp(db);
  const server = http.createServer(app);
  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

const PAYLOAD = JSON.stringify({
  Subject: 'Recruiter hello',
  FromFull: { Email: 'recruiter@newco.com' },
  OriginalRecipient: 'seeker@example.com',
  TextBody: 'Hello there',
  Date: '2026-07-01T09:00:00.000Z',
});

function basicAuthHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

async function postWebhook(
  baseUrl: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/webhooks/postmark/inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: PAYLOAD,
  });
}

describe('postmark inbound webhook authentication', () => {
  const ENV_KEYS = [
    'NODE_ENV',
    'POSTMARK_WEBHOOK_USER',
    'POSTMARK_WEBHOOK_PASSWORD',
  ] as const;
  let savedEnv: Record<string, string | undefined>;
  let scheduled: string[];

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    scheduled = [];
    setInboundEmailProcessingScheduler((_db, emailId) => {
      scheduled.push(emailId);
    });
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    resetInboundEmailProcessingScheduler();
    jest.restoreAllMocks();
  });

  it('production + valid credentials → accepted and reaches the pipeline', async () => {
    process.env.NODE_ENV = 'production';
    process.env.POSTMARK_WEBHOOK_USER = 'hook-user';
    process.env.POSTMARK_WEBHOOK_PASSWORD = 'hook-pass';
    const db = createTestDb();
    seedTestUser(db, { email: 'seeker@example.com' });

    const { baseUrl, close } = await startServer(db);
    const res = await postWebhook(baseUrl, {
      Authorization: basicAuthHeader('hook-user', 'hook-pass'),
    });

    expect(res.status).toBe(200);
    const rows = db.select().from(inboundEmails).all();
    expect(rows).toHaveLength(1);
    expect(scheduled).toEqual([rows[0].id]);
    await close();
  });

  it('production + missing auth → rejected (401) and never persisted', async () => {
    process.env.NODE_ENV = 'production';
    process.env.POSTMARK_WEBHOOK_USER = 'hook-user';
    process.env.POSTMARK_WEBHOOK_PASSWORD = 'hook-pass';
    const db = createTestDb();

    const { baseUrl, close } = await startServer(db);
    const res = await postWebhook(baseUrl); // no Authorization header

    expect(res.status).toBe(401);
    expect(db.select().from(inboundEmails).all()).toHaveLength(0);
    expect(scheduled).toEqual([]);
    await close();
  });

  it('production + wrong credentials → rejected (401) and never persisted', async () => {
    process.env.NODE_ENV = 'production';
    process.env.POSTMARK_WEBHOOK_USER = 'hook-user';
    process.env.POSTMARK_WEBHOOK_PASSWORD = 'hook-pass';
    const db = createTestDb();

    const { baseUrl, close } = await startServer(db);
    const res = await postWebhook(baseUrl, {
      Authorization: basicAuthHeader('hook-user', 'WRONG-pass'),
    });

    expect(res.status).toBe(401);
    expect(db.select().from(inboundEmails).all()).toHaveLength(0);
    expect(scheduled).toEqual([]);
    await close();
  });

  it('production + unset secret (misconfiguration) → fails closed (503), logs clearly, never persisted', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.POSTMARK_WEBHOOK_USER;
    delete process.env.POSTMARK_WEBHOOK_PASSWORD;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const db = createTestDb();

    const { baseUrl, close } = await startServer(db);
    const res = await postWebhook(baseUrl, {
      Authorization: basicAuthHeader('anyone', 'anything'),
    });

    expect(res.status).toBe(503);
    expect(db.select().from(inboundEmails).all()).toHaveLength(0);
    expect(scheduled).toEqual([]);
    // Misconfiguration must be loud and visible, not a silent rejection.
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/postmark/i);
    expect(logged).toMatch(/production/i);
    await close();
  });

  it('development + no credentials → unchanged easy local behavior (accepted)', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.POSTMARK_WEBHOOK_USER;
    delete process.env.POSTMARK_WEBHOOK_PASSWORD;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const db = createTestDb();
    seedTestUser(db, { email: 'seeker@example.com' });

    const { baseUrl, close } = await startServer(db);
    const res = await postWebhook(baseUrl); // no auth, as in local dev

    expect(res.status).toBe(200);
    const rows = db.select().from(inboundEmails).all();
    expect(rows).toHaveLength(1);
    expect(scheduled).toEqual([rows[0].id]);
    await close();
  });
});
