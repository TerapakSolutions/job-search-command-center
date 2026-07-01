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
  process.env.SESSION_SECRET = 'test-session-secret-for-inbound-emails';
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

describe('inbound emails API', () => {
  it('lists only emails belonging to the authenticated user', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const otherUserId = seedTestUser(db, {
      id: 'user-other',
      email: 'other@example.com',
    });
    seedApplication(db, userId);

    const mineId = seedInboundEmail(db, {
      id: 'email-mine',
      toEmail: 'seeker@example.com',
      subject: 'Your application',
      receivedAt: '2026-07-02T10:00:00.000Z',
    });
    seedInboundEmail(db, {
      id: 'email-other',
      toEmail: 'other@example.com',
      subject: 'Other user mail',
      receivedAt: '2026-07-02T11:00:00.000Z',
    });
    seedInboundEmail(db, {
      id: 'email-contact',
      fromEmail: 'hr@bigco.com',
      toEmail: 'inbound@postmark.com',
      subject: 'Contact matched',
      receivedAt: '2026-07-01T09:00:00.000Z',
    });

    const ts = nowIso();
    db.insert(contacts)
      .values({
        id: createId(),
        userId,
        applicationId: 'app-1',
        name: 'HR',
        email: 'hr@bigco.com',
        linkedIn: '',
        messageNotes: '',
        nextAction: '',
        createdAt: ts,
        updatedAt: ts,
      })
      .run();

    const { baseUrl, close } = await startServer(db);
    const cookie = `session=${encodeURIComponent(createSessionToken(userId))}`;

    const listRes = await fetch(`${baseUrl}/api/inbound-emails`, {
      headers: { Cookie: cookie },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as {
      items: { id: string; subject: string }[];
      total: number;
    };
    expect(list.total).toBe(2);
    expect(list.items.map((e) => e.id)).toEqual(['email-mine', 'email-contact']);
    expect(list.items[0]).not.toHaveProperty('payload');
    expect(list.items[0]).not.toHaveProperty('textBody');

    const otherCookie = `session=${encodeURIComponent(createSessionToken(otherUserId))}`;
    const otherListRes = await fetch(`${baseUrl}/api/inbound-emails`, {
      headers: { Cookie: otherCookie },
    });
    const otherList = (await otherListRes.json()) as { total: number };
    expect(otherList.total).toBe(1);

    const unauthRes = await fetch(`${baseUrl}/api/inbound-emails`);
    expect(unauthRes.status).toBe(401);

    await close();
    void mineId;
  });

  it('returns detail with body fields and blocks cross-user access', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    const otherUserId = seedTestUser(db, {
      id: 'user-other',
      email: 'other@example.com',
    });

    const emailId = seedInboundEmail(db, {
      id: 'email-detail',
      toEmail: 'seeker@example.com',
      subject: 'Interview invite',
      payload: JSON.stringify({
        TextBody: 'Plain text content',
        HtmlBody: '<p>HTML content</p>',
      }),
    });
    seedInboundEmail(db, {
      id: 'email-secret',
      toEmail: 'other@example.com',
      subject: 'Secret',
    });

    const { baseUrl, close } = await startServer(db);
    const cookie = `session=${encodeURIComponent(createSessionToken(userId))}`;
    const otherCookie = `session=${encodeURIComponent(createSessionToken(otherUserId))}`;

    const detailRes = await fetch(`${baseUrl}/api/inbound-emails/${emailId}`, {
      headers: { Cookie: cookie },
    });
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      subject: string;
      textBody: string;
      htmlBody: string;
    };
    expect(detail.subject).toBe('Interview invite');
    expect(detail.textBody).toBe('Plain text content');
    expect(detail.htmlBody).toBe('<p>HTML content</p>');

    const blockedRes = await fetch(`${baseUrl}/api/inbound-emails/email-secret`, {
      headers: { Cookie: cookie },
    });
    expect(blockedRes.status).toBe(404);

    const otherBlockedRes = await fetch(
      `${baseUrl}/api/inbound-emails/${emailId}`,
      { headers: { Cookie: otherCookie } },
    );
    expect(otherBlockedRes.status).toBe(404);

    await close();
  });

  it('marks email as processed and supports filters', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });

    const unprocessedId = seedInboundEmail(db, {
      id: 'email-unprocessed',
      toEmail: 'seeker@example.com',
      subject: 'Follow up needed',
      fromEmail: 'recruiter@startup.io',
      processed: false,
      receivedAt: '2026-07-03T08:00:00.000Z',
    });
    seedInboundEmail(db, {
      id: 'email-done',
      toEmail: 'seeker@example.com',
      subject: 'Already reviewed',
      fromEmail: 'jobs@corp.com',
      processed: true,
      receivedAt: '2026-07-02T08:00:00.000Z',
    });

    const { baseUrl, close } = await startServer(db);
    const cookie = `session=${encodeURIComponent(createSessionToken(userId))}`;

    const patchRes = await fetch(
      `${baseUrl}/api/inbound-emails/${unprocessedId}`,
      {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ processed: true }),
      },
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { processed: boolean };
    expect(patched.processed).toBe(true);

    const unprocessedListRes = await fetch(
      `${baseUrl}/api/inbound-emails?processed=false`,
      { headers: { Cookie: cookie } },
    );
    const unprocessedList = (await unprocessedListRes.json()) as { total: number };
    expect(unprocessedList.total).toBe(0);

    const senderRes = await fetch(
      `${baseUrl}/api/inbound-emails?sender=corp.com`,
      { headers: { Cookie: cookie } },
    );
    const senderList = (await senderRes.json()) as {
      items: { subject: string }[];
    };
    expect(senderList.items).toHaveLength(1);
    expect(senderList.items[0].subject).toBe('Already reviewed');

    const badPatchRes = await fetch(
      `${baseUrl}/api/inbound-emails/${unprocessedId}`,
      {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ processed: 'yes' }),
      },
    );
    expect(badPatchRes.status).toBe(400);

    await close();
  });

  it('classifies a single email and returns updated detail', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });

    const emailId = seedInboundEmail(db, {
      id: 'email-classify-api',
      toEmail: 'seeker@example.com',
      subject: 'Interview next steps',
      payload: JSON.stringify({
        TextBody:
          'We reviewed your resume and want to schedule an interview with you.',
      }),
    });

    const { baseUrl, close } = await startServer(db);
    const cookie = `session=${encodeURIComponent(createSessionToken(userId))}`;

    const classifyRes = await fetch(
      `${baseUrl}/api/inbound-emails/${emailId}/classify`,
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      },
    );
    expect(classifyRes.status).toBe(200);
    const classified = (await classifyRes.json()) as {
      classification: { classification: string; suggestedAction: string };
      email: { classification: string; aiSummary: string | null };
    };
    expect(classified.classification.classification).toBe('Interview Request');
    expect(classified.email.classification).toBe('Interview Request');
    expect(classified.email.aiSummary).toBeTruthy();

    const reClassifyRes = await fetch(
      `${baseUrl}/api/inbound-emails/${emailId}/classify`,
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      },
    );
    expect(reClassifyRes.status).toBe(200);

    const blockedRes = await fetch(
      `${baseUrl}/api/inbound-emails/email-secret/classify`,
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(blockedRes.status).toBe(404);

    await close();
  });

  it('classifies unprocessed emails in batch', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });

    seedInboundEmail(db, {
      id: 'batch-1',
      toEmail: 'seeker@example.com',
      payload: JSON.stringify({ TextBody: 'Thank you for applying.' }),
    });
    seedInboundEmail(db, {
      id: 'batch-2',
      toEmail: 'seeker@example.com',
      payload: JSON.stringify({
        TextBody: 'We decided to move forward with other candidates.',
      }),
    });

    const { baseUrl, close } = await startServer(db);
    const cookie = `session=${encodeURIComponent(createSessionToken(userId))}`;

    const batchRes = await fetch(
      `${baseUrl}/api/inbound-emails/classify-unprocessed`,
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10 }),
      },
    );
    expect(batchRes.status).toBe(200);
    const batch = (await batchRes.json()) as { classified: number };
    expect(batch.classified).toBe(2);

    await close();
  });

  it('soft deletes an email and removes it from the list', async () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });

    const deleteId = seedInboundEmail(db, {
      id: 'email-delete-me',
      toEmail: 'seeker@example.com',
      subject: 'Delete me',
    });
    seedInboundEmail(db, {
      id: 'email-keep',
      toEmail: 'seeker@example.com',
      subject: 'Keep me',
    });

    const { baseUrl, close } = await startServer(db);
    const cookie = `session=${encodeURIComponent(createSessionToken(userId))}`;

    const deleteRes = await fetch(`${baseUrl}/api/inbound-emails/${deleteId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleteRes.status).toBe(204);

    const listRes = await fetch(`${baseUrl}/api/inbound-emails`, {
      headers: { Cookie: cookie },
    });
    const list = (await listRes.json()) as { total: number; items: { id: string }[] };
    expect(list.total).toBe(1);
    expect(list.items[0].id).toBe('email-keep');

    const detailRes = await fetch(`${baseUrl}/api/inbound-emails/${deleteId}`, {
      headers: { Cookie: cookie },
    });
    expect(detailRes.status).toBe(404);

    const repeatDeleteRes = await fetch(
      `${baseUrl}/api/inbound-emails/${deleteId}`,
      {
        method: 'DELETE',
        headers: { Cookie: cookie },
      },
    );
    expect(repeatDeleteRes.status).toBe(404);

    await close();
  });
});
