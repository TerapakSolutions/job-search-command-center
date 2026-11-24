/** @jest-environment node */
import http from 'node:http';
import { createApp } from '../app.js';
import { createSessionToken } from '../lib/session.js';
import { createTestDb, seedTestUser } from '../lib/testDb.js';

const FIELDS = ['declineDetectedAt', 'threadClosedAt', 'threadKeptOpenAt'] as const;

describe('contacts: thread fields over the API', () => {
  const saved = process.env.SESSION_SECRET;
  beforeAll(() => {
    process.env.SESSION_SECRET = 'test-session-secret-for-thread-fields';
  });
  afterAll(() => {
    process.env.SESSION_SECRET = saved;
  });

  it('creates (import), updates, clears and lists every field', async () => {
    const db = createTestDb();
    const cookie = `session=${encodeURIComponent(createSessionToken(seedTestUser(db)))}`;
    const server = http.createServer(createApp(db));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };
    const call = async (method: string, path: string, body?: unknown) =>
      (await fetch(`http://127.0.0.1:${port}/api/contacts${path}`, {
        method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })).json();
    try {
      const at = '2026-11-24T20:00:00.000Z';
      const all = Object.fromEntries(FIELDS.map((f) => [f, at]));
      const made = (await call('POST', '', { name: 'Maya Lund', ...all })) as Record<string, string>;
      expect(made).toMatchObject(all);
      for (const f of FIELDS) {
        expect(await call('PUT', `/${made.id}`, { [f]: null })).toMatchObject({ [f]: null });
        expect(await call('PUT', `/${made.id}`, { [f]: '2026-11-25T00:00:00.000Z' })).toMatchObject({ [f]: '2026-11-25T00:00:00.000Z' });
      }
      expect(((await call('GET', '')) as unknown[])[0]).toMatchObject(Object.fromEntries(FIELDS.map((f) => [f, '2026-11-25T00:00:00.000Z'])));
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
