/** @jest-environment node */
import http from 'node:http';
import { createApp } from '../app.js';
import { createSessionToken } from '../lib/session.js';
import { createTestDb, seedTestUser } from '../lib/testDb.js';

async function withServer<T>(
  db: ReturnType<typeof createTestDb>,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer(createApp(db));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const base = {
  company: 'Client Co',
  roleTitle: 'Solution Architect',
  jobUrl: '',
  workLocationType: 'hybrid',
  location: 'Example City',
  dateApplied: null,
  status: 'recruiter_screen',
  notes: '',
  interviewDate: null,
};

describe('applications: contract rate and submission fields', () => {
  const saved = process.env.SESSION_SECRET;
  beforeAll(() => {
    process.env.SESSION_SECRET = 'test-session-secret-for-contract-fields';
  });
  afterAll(() => {
    process.env.SESSION_SECRET = saved;
  });

  it('stores and returns an hourly rate, engagement type, agency and submitted date', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const cookie = `session=${encodeURIComponent(createSessionToken(userId))}`;
    await withServer(db, async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/applications`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...base,
          salaryMin: 62.5,
          salaryMax: 62.5,
          payPeriod: 'hour',
          employmentType: 'w2_contract',
          agency: 'Acme Staffing',
          submittedDate: '2026-11-10',
        }),
      });
      expect(created.status).toBeLessThan(300);
      const { id } = (await created.json()) as { id: string };

      const list = (await (
        await fetch(`${baseUrl}/api/applications`, { headers: { Cookie: cookie } })
      ).json()) as Array<Record<string, unknown>>;
      const app = list.find((a) => a.id === id);
      expect(app).toMatchObject({
        salaryMin: 62.5,
        salaryMax: 62.5,
        payPeriod: 'hour',
        employmentType: 'w2_contract',
        agency: 'Acme Staffing',
        submittedDate: '2026-11-10',
      });

      const updated = await fetch(`${baseUrl}/api/applications/${id}`, {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ employmentType: 'c2c', agency: '', submittedDate: null }),
      });
      expect(updated.status).toBeLessThan(300);
      const after = (await (
        await fetch(`${baseUrl}/api/applications`, { headers: { Cookie: cookie } })
      ).json()) as Array<Record<string, unknown>>;
      expect(after.find((a) => a.id === id)).toMatchObject({
        employmentType: 'c2c',
        agency: null,
        submittedDate: null,
        payPeriod: 'hour',
      });
    });
  });

  it('stores null for an unknown pay period or engagement type', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const cookie = `session=${encodeURIComponent(createSessionToken(userId))}`;
    await withServer(db, async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/applications`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, payPeriod: 'fortnight', employmentType: 'gig' }),
      });
      const { id } = (await created.json()) as { id: string };
      const list = (await (
        await fetch(`${baseUrl}/api/applications`, { headers: { Cookie: cookie } })
      ).json()) as Array<Record<string, unknown>>;
      expect(list.find((a) => a.id === id)).toMatchObject({ payPeriod: null, employmentType: null });
    });
  });

  it('leaves the new fields null on an application created without them', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const cookie = `session=${encodeURIComponent(createSessionToken(userId))}`;
    await withServer(db, async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/applications`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, salaryMin: 120000, salaryMax: 150000 }),
      });
      const { id } = (await created.json()) as { id: string };
      const list = (await (
        await fetch(`${baseUrl}/api/applications`, { headers: { Cookie: cookie } })
      ).json()) as Array<Record<string, unknown>>;
      expect(list.find((a) => a.id === id)).toMatchObject({
        salaryMin: 120000,
        payPeriod: null,
        employmentType: null,
        agency: null,
        submittedDate: null,
      });
    });
  });
});
