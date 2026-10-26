/** @jest-environment node */
import http from 'node:http';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';
import { inboundEmails } from '../db/schema.js';
import {
  resetInboundEmailProcessingScheduler,
  setInboundEmailProcessingScheduler,
} from '../lib/inboundEmailProcessingQueue.js';
import { createTestDb, seedTestUser } from '../lib/testDb.js';

function startServer(db: ReturnType<typeof createTestDb>) {
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

describe('postmark inbound webhook', () => {
  afterEach(() => {
    resetInboundEmailProcessingScheduler();
  });

  it('persists quickly and triggers background processing', async () => {
    const db = createTestDb();
    seedTestUser(db, { email: 'seeker@example.com' });
    const scheduled: string[] = [];
    setInboundEmailProcessingScheduler((_db, emailId) => {
      scheduled.push(emailId);
    });

    const { baseUrl, close } = await startServer(db);
    const started = Date.now();
    const res = await fetch(`${baseUrl}/webhooks/postmark/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Subject: 'Recruiter hello',
        FromFull: { Email: 'recruiter@newco.com' },
        OriginalRecipient: 'seeker@example.com',
        TextBody: 'Hello there',
        Date: '2026-07-01T09:00:00.000Z',
      }),
    });
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toBeTruthy();
    expect(elapsed).toBeLessThan(500);
    expect(scheduled).toEqual([body.id]);

    const row = db
      .select()
      .from(inboundEmails)
      .where(eq(inboundEmails.id, body.id))
      .all()[0];
    expect(row.processingStatus).toBe('unprocessed');
    expect(row.subject).toBe('Recruiter hello');

    await close();
  });
});

describe('postmark inbound webhook body size', () => {
  afterEach(() => {
    resetInboundEmailProcessingScheduler();
  });

  // Forwarded emails carry base64 attachments and quoted HTML; express.json()'s
  // 100kb default rejected them with 413 (prod, 2026-10-26).
  it('accepts a forwarded email with a multi-megabyte attachment', async () => {
    const db = createTestDb();
    seedTestUser(db, { email: 'seeker@example.com' });
    setInboundEmailProcessingScheduler(() => {});

    const { baseUrl, close } = await startServer(db);
    const res = await fetch(`${baseUrl}/webhooks/postmark/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Subject: 'Fwd: Virtual Interview',
        FromFull: { Email: 'seeker@example.com' },
        OriginalRecipient: 'seeker@example.com',
        TextBody: 'See below',
        Date: '2026-10-26T18:03:00.000Z',
        Attachments: [
          {
            Name: 'invite.pdf',
            ContentType: 'application/pdf',
            Content: 'A'.repeat(5 * 1024 * 1024),
          },
        ],
      }),
    });
    await close();

    expect(res.status).toBe(200);
  });
});
