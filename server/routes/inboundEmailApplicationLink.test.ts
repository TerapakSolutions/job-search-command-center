/** @jest-environment node */
import http from 'node:http';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';
import { applications, contacts } from '../db/schema.js';
import { analyzeEmailAutomation } from '../lib/emailAutomationService.js';
import { createSessionToken } from '../lib/session.js';
import {
  createTestDb,
  seedApplication,
  seedInboundEmail,
  seedTestUser,
} from '../lib/testDb.js';

type Db = ReturnType<typeof createTestDb>;

async function withServer<T>(db: Db, fn: (baseUrl: string) => Promise<T>): Promise<T> {
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

function cookieFor(userId: string) {
  return `session=${encodeURIComponent(createSessionToken(userId))}`;
}

async function putLink(baseUrl: string, userId: string, emailId: string, applicationId: string | null) {
  return fetch(`${baseUrl}/api/inbound-emails/${emailId}/link`, {
    method: 'PUT',
    headers: { Cookie: cookieFor(userId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationId }),
  });
}

// An email whose role wording shares nothing with the application's, so the
// matcher scores it below the threshold on its own.
function seedUnmatchedPair(db: Db, userId: string) {
  const appId = seedApplication(db, userId, {
    id: 'app-client',
    company: 'Client Co',
    roleTitle: 'Engineering Manager',
    status: 'recruiter_screen',
  });
  const emailId = seedInboundEmail(db, {
    id: 'email-followup',
    fromEmail: 'seeker@example.com',
    toEmail: 'jobs@inbound.example',
    classification: 'Follow-up Required',
    classificationConfidence: 85,
    companyName: 'Client',
    positionTitle: 'Platform Lead',
  });
  return { appId, emailId };
}

describe('linking an inbound email to an application', () => {
  const saved = process.env.SESSION_SECRET;
  beforeAll(() => {
    process.env.SESSION_SECRET = 'test-session-secret-for-email-link';
  });
  afterAll(() => {
    process.env.SESSION_SECRET = saved;
  });

  it('control: without a link, the weak match is not the best match', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const { emailId } = seedUnmatchedPair(db, userId);
    const analysis = analyzeEmailAutomation(db, userId, emailId);
    expect(analysis?.matches.bestMatch).toBeNull();
    expect(analysis?.matches.linkedApplicationId).toBeNull();
  });

  it('links, re-links and unlinks; a link makes that application the best match', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const { appId, emailId } = seedUnmatchedPair(db, userId);
    const otherApp = seedApplication(db, userId, { id: 'app-other', company: 'Other Co' });

    await withServer(db, async (baseUrl) => {
      expect((await putLink(baseUrl, userId, emailId, appId)).status).toBe(200);
      let analysis = analyzeEmailAutomation(db, userId, emailId);
      expect(analysis?.matches.linkedApplicationId).toBe(appId);
      expect(analysis?.matches.bestMatch).toMatchObject({
        applicationId: appId,
        confidence: 100,
        matchReasons: ['Linked by you'],
      });
      expect(analysis?.matches.requiresManualSelection).toBe(false);

      expect((await putLink(baseUrl, userId, emailId, otherApp)).status).toBe(200);
      analysis = analyzeEmailAutomation(db, userId, emailId);
      expect(analysis?.matches.bestMatch?.applicationId).toBe(otherApp);

      expect((await putLink(baseUrl, userId, emailId, null)).status).toBe(200);
      analysis = analyzeEmailAutomation(db, userId, emailId);
      expect(analysis?.matches.linkedApplicationId).toBeNull();
      expect(analysis?.matches.bestMatch).toBeNull();
    });
  });

  it('linking alone changes nothing on the application', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const { appId, emailId } = seedUnmatchedPair(db, userId);
    const before = db.select().from(applications).where(eq(applications.id, appId)).all();
    await withServer(db, async (baseUrl) => {
      await putLink(baseUrl, userId, emailId, appId);
    });
    expect(db.select().from(applications).where(eq(applications.id, appId)).all()).toEqual(before);
  });

  it("refuses another user's application, or one that does not exist, and stores nothing", async () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const otherUser = seedTestUser(db, { id: 'user-2', email: 'other@example.com' });
    const { emailId } = seedUnmatchedPair(db, userId);
    const foreignApp = seedApplication(db, otherUser, { id: 'app-foreign' });

    await withServer(db, async (baseUrl) => {
      expect((await putLink(baseUrl, userId, emailId, foreignApp)).status).toBe(404);
      expect((await putLink(baseUrl, userId, emailId, 'app-missing')).status).toBe(404);
    });
    expect(analyzeEmailAutomation(db, userId, emailId)?.matches.linkedApplicationId).toBeNull();
  });

  it("refuses an email the user does not own", async () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const otherUser = seedTestUser(db, { id: 'user-2', email: 'other@example.com' });
    const otherEmail = seedInboundEmail(db, {
      id: 'email-other',
      fromEmail: 'other@example.com',
      toEmail: 'jobs@inbound.example',
    });
    const appId = seedApplication(db, userId, { id: 'app-mine' });
    await withServer(db, async (baseUrl) => {
      expect((await putLink(baseUrl, userId, otherEmail, appId)).status).toBe(404);
    });
    expect(analyzeEmailAutomation(db, otherUser, otherEmail)?.matches.linkedApplicationId).toBeNull();
  });

  it('two users who share an email link it independently', async () => {
    const db = createTestDb();
    const userA = seedTestUser(db, { id: 'user-a', email: 'a@example.com' });
    const userB = seedTestUser(db, { id: 'user-b', email: 'b@example.com' });
    const appA = seedApplication(db, userA, { id: 'app-a', company: 'Acme Corp' });
    const appB = seedApplication(db, userB, { id: 'app-b', company: 'Acme Corp' });
    // Both users saved the recruiter as a contact, so both own the email.
    const ts = '2026-07-01T00:00:00.000Z';
    for (const [id, userId] of [['c-a', userA], ['c-b', userB]] as const) {
      db.insert(contacts)
        .values({ id, userId, name: 'Recruiter', email: 'recruiter@acme.com', createdAt: ts, updatedAt: ts })
        .run();
    }
    const emailId = seedInboundEmail(db, {
      id: 'email-shared',
      fromEmail: 'recruiter@acme.com',
      toEmail: 'jobs@inbound.example',
    });

    await withServer(db, async (baseUrl) => {
      expect((await putLink(baseUrl, userA, emailId, appA)).status).toBe(200);
      expect(analyzeEmailAutomation(db, userB, emailId)?.matches.linkedApplicationId).toBeNull();
      expect((await putLink(baseUrl, userB, emailId, appB)).status).toBe(200);
    });
    expect(analyzeEmailAutomation(db, userA, emailId)?.matches.linkedApplicationId).toBe(appA);
    expect(analyzeEmailAutomation(db, userB, emailId)?.matches.linkedApplicationId).toBe(appB);
  });

  it('deleting the linked application removes the link and matching falls back to scoring', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    const { appId, emailId } = seedUnmatchedPair(db, userId);
    await withServer(db, async (baseUrl) => {
      await putLink(baseUrl, userId, emailId, appId);
    });
    db.delete(applications).where(eq(applications.id, appId)).run();
    const analysis = analyzeEmailAutomation(db, userId, emailId);
    expect(analysis?.matches.linkedApplicationId).toBeNull();
    expect(analysis?.matches.bestMatch).toBeNull();
  });
});
