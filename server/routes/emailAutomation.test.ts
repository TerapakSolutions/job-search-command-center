/** @jest-environment node */
import http from 'node:http';
import { createApp } from '../app.js';
import { createSessionToken } from '../lib/session.js';
import {
  createTestDb,
  seedApplication,
  seedInboundEmail,
  seedTestUser,
} from '../lib/testDb.js';
import { contacts } from '../db/schema.js';
import { createId, nowIso } from '../lib/id.js';

function startServer(db: ReturnType<typeof createTestDb>) {
  process.env.SESSION_SECRET = 'test-session-secret-for-email-automation';
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

describe('email automation API', () => {
  it('returns automation analysis for classified email', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const appId = seedApplication(db, userId, {
      id: 'app-auto',
      company: 'Acme Corp',
      roleTitle: 'Engineer',
    });
    const ts = nowIso();
    db.insert(contacts)
      .values({
        id: createId(),
        userId,
        applicationId: appId,
        name: 'Jane',
        email: 'recruiter@acme.com',
        linkedIn: '',
        messageNotes: '',
        nextAction: '',
        createdAt: ts,
        updatedAt: ts,
      })
      .run();

    const emailId = seedInboundEmail(db, {
      id: 'email-auto',
      toEmail: 'seeker@example.com',
      fromEmail: 'recruiter@acme.com',
      classification: 'Interview Request',
      classificationConfidence: 90,
      companyName: 'Acme Corp',
      positionTitle: 'Engineer',
      processedAt: '2026-07-01T10:00:00.000Z',
    });

    const { baseUrl, close } = await startServer(db);
    const cookie = `session=${encodeURIComponent(createSessionToken(userId))}`;

    const analysisRes = await fetch(
      `${baseUrl}/api/inbound-emails/${emailId}/automation`,
      { headers: { Cookie: cookie } },
    );
    expect(analysisRes.status).toBe(200);
    const analysis = (await analysisRes.json()) as {
      matches: { matches: unknown[]; bestMatch: { applicationId: string } | null };
      nextActions: unknown[];
    };
    expect(analysis.matches.matches.length).toBeGreaterThan(0);
    expect(analysis.matches.bestMatch?.applicationId).toBe(appId);
    expect(analysis.nextActions.length).toBeGreaterThan(0);

    const draftRes = await fetch(
      `${baseUrl}/api/inbound-emails/${emailId}/automation/draft-reply`,
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(draftRes.status).toBe(200);
    const draft = (await draftRes.json()) as { draft: string };
    expect(draft.draft).toContain('Hi');

    const dashboardRes = await fetch(`${baseUrl}/api/email-automation/dashboard`, {
      headers: { Cookie: cookie },
    });
    expect(dashboardRes.status).toBe(200);

    await close();
  });

  it('creates application via automation endpoint', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const emailId = seedInboundEmail(db, {
      id: 'email-create',
      toEmail: 'seeker@example.com',
      classification: 'Application Confirmation',
      classificationConfidence: 80,
      companyName: 'StartupXYZ',
      positionTitle: 'Full Stack Developer',
      processedAt: '2026-07-01T10:00:00.000Z',
    });

    const { baseUrl, close } = await startServer(db);
    const cookie = `session=${encodeURIComponent(createSessionToken(userId))}`;

    const createRes = await fetch(
      `${baseUrl}/api/inbound-emails/${emailId}/automation/create-application`,
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      success: boolean;
      changes: { applicationId: string };
    };
    expect(created.success).toBe(true);
    expect(created.changes.applicationId).toBeTruthy();

    const auditRes = await fetch(`${baseUrl}/api/email-automation/audit`, {
      headers: { Cookie: cookie },
    });
    const audit = (await auditRes.json()) as { items: { actionType: string }[] };
    expect(audit.items.some((i) => i.actionType === 'create_application')).toBe(true);

    await close();
  });
});
