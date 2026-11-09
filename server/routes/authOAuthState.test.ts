/** @jest-environment node */
import http from 'node:http';
import { createApp } from '../app.js';
import { users } from '../db/schema.js';
import { createTestDb } from '../lib/testDb.js';

// Login CSRF: the callback must only accept a code from a sign-in this
// browser started, proven by a one-time `state` echoed back by Google that
// matches a cookie set by GET /auth/google.

interface RawResponse {
  status: number;
  location: string;
  setCookies: string[];
}

async function request(
  db: ReturnType<typeof createTestDb>,
  path: string,
  cookie?: string,
): Promise<RawResponse> {
  const server = http.createServer(createApp(db));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    return await new Promise<RawResponse>((resolve, reject) => {
      http
        .get(
          `http://127.0.0.1:${port}${path}`,
          { headers: cookie ? { cookie } : {} },
          (res) => {
            res.resume();
            resolve({
              status: res.statusCode ?? 0,
              location: res.headers.location ?? '',
              setCookies: res.headers['set-cookie'] ?? [],
            });
          },
        )
        .on('error', reject);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function stubGoogle() {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ id: 'g-alex', email: 'alex@example.com', verified_email: true, name: 'Alex' }),
      { status: 200 },
    );
  });
}

function stateCookie(setCookies: string[]): string | undefined {
  return setCookies.find((c) => c.startsWith('oauth_state='));
}

function expectStateCleared(setCookies: string[]) {
  const cleared = stateCookie(setCookies);
  expect(cleared).toBeDefined();
  expect(cleared).toMatch(/^oauth_state=;/);
  expect(cleared).toContain('Max-Age=0');
  expect(cleared).toContain('Path=/auth');
}

const VALID = 'a'.repeat(43);

describe('Google sign-in state (login CSRF)', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-session-secret-for-oauth-state';
    process.env.GOOGLE_CLIENT_ID = 'client';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.APP_URL = 'https://app.example.com';
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.NODE_ENV = 'production';
  });
  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  it('GET /auth/google sets a state cookie and sends the same value to Google', async () => {
    const res = await request(createTestDb(), '/auth/google');
    expect(res.status).toBe(302);
    const google = new URL(res.location);
    expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const state = google.searchParams.get('state');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const cookie = stateCookie(res.setCookies);
    expect(cookie).toBeDefined();
    expect(cookie!.split(';')[0]).toBe(`oauth_state=${state}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/auth');
    expect(cookie).toContain('Max-Age=600');
    expect(cookie).toContain('Secure');
  });

  it('GET /auth/google issues a different state each time', async () => {
    const db = createTestDb();
    const a = new URL((await request(db, '/auth/google')).location).searchParams.get('state');
    const b = new URL((await request(db, '/auth/google')).location).searchParams.get('state');
    expect(a).not.toBe(b);
  });

  it('omits Secure outside production, like the session cookie', async () => {
    process.env.NODE_ENV = 'development';
    const res = await request(createTestDb(), '/auth/google');
    expect(stateCookie(res.setCookies)).not.toContain('Secure');
  });

  it('rejects a callback with no state, without calling Google or touching the DB', async () => {
    const db = createTestDb();
    const fetchSpy = stubGoogle();
    const res = await request(db, '/auth/google/callback?code=attacker', `oauth_state=${VALID}`);
    expect(res.location).toBe('https://app.example.com/login?error=state_mismatch');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.select().from(users).all()).toEqual([]);
    expectStateCleared(res.setCookies);
  });

  it('rejects a callback with no state cookie', async () => {
    const db = createTestDb();
    const fetchSpy = stubGoogle();
    const res = await request(db, `/auth/google/callback?code=attacker&state=${VALID}`);
    expect(res.location).toBe('https://app.example.com/login?error=state_mismatch');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.select().from(users).all()).toEqual([]);
    expectStateCleared(res.setCookies);
  });

  it('rejects a callback whose state does not match the cookie', async () => {
    const db = createTestDb();
    const fetchSpy = stubGoogle();
    const res = await request(
      db,
      `/auth/google/callback?code=attacker&state=${'b'.repeat(43)}`,
      `oauth_state=${VALID}`,
    );
    expect(res.location).toBe('https://app.example.com/login?error=state_mismatch');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.select().from(users).all()).toEqual([]);
    expectStateCleared(res.setCookies);
  });

  it('rejects a different-length state without throwing', async () => {
    const fetchSpy = stubGoogle();
    const res = await request(
      createTestDb(),
      '/auth/google/callback?code=attacker&state=short',
      `oauth_state=${VALID}`,
    );
    expect(res.location).toBe('https://app.example.com/login?error=state_mismatch');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a repeated state param and a malformed cookie without a 500', async () => {
    const fetchSpy = stubGoogle();
    const repeated = await request(
      createTestDb(),
      `/auth/google/callback?code=x&state=${VALID}&state=${VALID}`,
      `oauth_state=${VALID}`,
    );
    expect(repeated.location).toBe('https://app.example.com/login?error=state_mismatch');
    const malformed = await request(
      createTestDb(),
      `/auth/google/callback?code=x&state=${VALID}`,
      'oauth_state=%E0%A4%A',
    );
    expect(malformed.location).toBe('https://app.example.com/login?error=state_mismatch');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('signs in when state matches, and clears the state cookie alongside the session', async () => {
    const db = createTestDb();
    const fetchSpy = stubGoogle();
    const res = await request(
      db,
      `/auth/google/callback?code=good&state=${VALID}`,
      `oauth_state=${VALID}`,
    );
    expect(res.location).toBe('https://app.example.com/today');
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://oauth2.googleapis.com/token');
    expect(db.select().from(users).all().map((u) => u.email)).toEqual(['alex@example.com']);
    expect(res.setCookies.some((c) => c.startsWith('session='))).toBe(true);
    expectStateCleared(res.setCookies);
  });
});
