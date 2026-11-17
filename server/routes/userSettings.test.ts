/** @jest-environment node */
import http from 'node:http';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';
import { users } from '../db/schema.js';
import { createSessionToken } from '../lib/session.js';
import { createTestDb, seedTestUser } from '../lib/testDb.js';

type TestDb = ReturnType<typeof createTestDb>;

// Invented users only.
async function startServer(db: TestDb) {
  process.env.SESSION_SECRET = 'test-session-secret-for-user-settings';
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

function stored(db: TestDb, userId: string): number | null {
  return db.select().from(users).where(eq(users.id, userId)).all()[0].followUpAfterDays;
}

describe('/api/user-settings — follow-up business days', () => {
  let db: TestDb;
  let alice: string;
  let bram: string;
  let server: Awaited<ReturnType<typeof startServer>>;

  const get = (cookie?: string) =>
    fetch(`${server.baseUrl}/api/user-settings`, { headers: cookie ? { Cookie: cookie } : {} });
  const put = (body: unknown, cookie?: string) =>
    fetch(`${server.baseUrl}/api/user-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });

  beforeEach(async () => {
    db = createTestDb();
    alice = seedTestUser(db, { id: 'user-alice', email: 'alice@example.test', name: 'Alice Quarry' });
    bram = seedTestUser(db, { id: 'user-bram', email: 'bram@example.test', name: 'Bram Ollerton' });
    server = await startServer(db);
  });

  afterEach(async () => {
    await server.close();
  });

  it('the column is nullable and a new user starts with NULL', () => {
    const col = (
      db.$client.prepare(`PRAGMA table_info('users')`).all() as Array<{
        name: string;
        notnull: number;
        dflt_value: unknown;
      }>
    ).find((c) => c.name === 'follow_up_after_days');
    expect(col).toEqual(expect.objectContaining({ notnull: 0, dflt_value: null }));
    expect(stored(db, alice)).toBeNull();
  });

  it('answers 401 when signed out, for GET and PUT, and writes nothing', async () => {
    expect((await get()).status).toBe(401);
    expect((await put({ followUpAfterDays: 7 })).status).toBe(401);
    expect(stored(db, alice)).toBeNull();
    expect(stored(db, bram)).toBeNull();
  });

  it('reads NULL as the default, 3', async () => {
    const res = await get(cookieFor(alice));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ followUpAfterDays: 3 });
  });

  it.each([1, 7, 14])('accepts %p, stores it, and reads it back', async (n) => {
    const res = await put({ followUpAfterDays: n }, cookieFor(alice));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ followUpAfterDays: n });
    expect(stored(db, alice)).toBe(n);
    expect(await (await get(cookieFor(alice))).json()).toEqual({ followUpAfterDays: n });
  });

  it.each([
    ['0', 0],
    ['15', 15],
    ['-1', -1],
    ['3.5', 3.5],
    ['a numeric string', '7'],
    ['a word', 'abc'],
    ['true', true],
    ['null', null],
  ])('rejects %s with 422 and leaves the stored value alone', async (_label, value) => {
    await put({ followUpAfterDays: 5 }, cookieFor(alice));
    const res = await put({ followUpAfterDays: value }, cookieFor(alice));
    expect(res.status).toBe(422);
    expect(stored(db, alice)).toBe(5);
  });

  it('rejects a missing body field with 422', async () => {
    const res = await put({}, cookieFor(alice));
    expect(res.status).toBe(422);
    expect(stored(db, alice)).toBeNull();
  });

  it("writes only the signed-in user's row; another user's value is untouched", async () => {
    await put({ followUpAfterDays: 9 }, cookieFor(bram));
    // A userId in the body is ignored: identity comes from the session.
    const res = await put({ followUpAfterDays: 2, userId: bram, id: bram }, cookieFor(alice));
    expect(res.status).toBe(200);
    expect(stored(db, alice)).toBe(2);
    expect(stored(db, bram)).toBe(9);
    expect(await (await get(cookieFor(bram))).json()).toEqual({ followUpAfterDays: 9 });
    expect(await (await get(cookieFor(alice))).json()).toEqual({ followUpAfterDays: 2 });
  });

  it('answers 401, not a false "saved", when the session user no longer exists', async () => {
    const res = await put({ followUpAfterDays: 7 }, cookieFor('user-gone'));
    expect(res.status).toBe(401);
    expect(stored(db, alice)).toBeNull();
    expect(stored(db, bram)).toBeNull();
  });
});
