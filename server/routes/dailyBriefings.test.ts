/** @jest-environment node */
import http from 'node:http';
import { createApp } from '../app.js';
import { generateDailyBriefingForUser } from '../lib/briefingGenerator.js';
import { createSessionToken } from '../lib/session.js';
import { createTestDb, seedApplication, seedTestUser } from '../lib/testDb.js';

function startServer(db: ReturnType<typeof createTestDb>) {
  process.env.SESSION_SECRET = 'test-session-secret-for-briefings';
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

describe('daily briefings API', () => {
  it('returns latest briefing for authenticated user only', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));

    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId);
    await generateDailyBriefingForUser(db, userId);

    const { baseUrl, close } = await startServer(db);
    const token = createSessionToken(userId);
    const cookie = `session=${encodeURIComponent(token)}`;

    const latestRes = await fetch(`${baseUrl}/api/daily-briefings/latest`, {
      headers: { Cookie: cookie },
    });
    expect(latestRes.status).toBe(200);
    const latest = (await latestRes.json()) as { aiSummary: string };
    expect(latest.aiSummary.length).toBeGreaterThan(0);

    const listRes = await fetch(`${baseUrl}/api/daily-briefings`, {
      headers: { Cookie: cookie },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as unknown[];
    expect(list.length).toBe(1);

    const unauthRes = await fetch(`${baseUrl}/api/daily-briefings/latest`);
    expect(unauthRes.status).toBe(401);

    await close();
    jest.useRealTimers();
  });

  it('runs cron job with valid secret', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));

    process.env.CRON_SECRET = 'cron-test-secret';
    const db = createTestDb();
    seedTestUser(db, { id: 'cron-user', email: 'cron@example.com' });
    seedApplication(db, 'cron-user');

    const { baseUrl, close } = await startServer(db);

    const badRes = await fetch(`${baseUrl}/api/cron/daily-briefings`, {
      method: 'POST',
    });
    expect(badRes.status).toBe(401);

    const okRes = await fetch(`${baseUrl}/api/cron/daily-briefings`, {
      method: 'POST',
      headers: { Authorization: 'Bearer cron-test-secret' },
    });
    expect(okRes.status).toBe(200);
    const body = (await okRes.json()) as { ok: boolean; generated: number };
    expect(body.ok).toBe(true);
    expect(body.generated).toBe(1);

    await close();
    delete process.env.CRON_SECRET;
    jest.useRealTimers();
  });
});
