/** @jest-environment node */
import http from 'node:http';
import { createApp } from '../app.js';
import { users } from '../db/schema.js';
import { createTestDb } from '../lib/testDb.js';

// The callback exchanges the code with Google, then reads the profile; both
// calls are stubbed so the test drives what Google "says" about the person.
function stubGoogle(profile: Record<string, unknown>) {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
    }
    return new Response(JSON.stringify(profile), { status: 200 });
  });
}

async function callback(db: ReturnType<typeof createTestDb>): Promise<string> {
  const server = http.createServer(createApp(db));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    return await new Promise<string>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/auth/google/callback?code=abc`, (res) => {
          res.resume();
          resolve(res.headers.location ?? '');
        })
        .on('error', reject);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('Google sign-in requires a verified email', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-session-secret-for-verified-email';
    process.env.GOOGLE_CLIENT_ID = 'client';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.NODE_ENV = 'production';
  });
  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  it('signs in anyone whose Google email is verified', async () => {
    const db = createTestDb();
    stubGoogle({ id: 'g-alex', email: 'alex@example.com', verified_email: true, name: 'Alex' });
    expect(await callback(db)).toBe('https://app.example.com/today');
    expect(db.select().from(users).all().map((u) => u.email)).toEqual(['alex@example.com']);
  });

  it('turns away an unverified Google email, without creating an account', async () => {
    const db = createTestDb();
    stubGoogle({ id: 'g-fake', email: 'alex@example.com', verified_email: false, name: 'Not Alex' });
    expect(await callback(db)).toBe('https://app.example.com/login?error=unverified_email');
    expect(db.select().from(users).all()).toEqual([]);
  });
});
