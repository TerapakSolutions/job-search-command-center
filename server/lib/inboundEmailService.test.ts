/** @jest-environment node */
import {
  getInboundEmailDetailForUser,
  inboundEmailBelongsToUser,
  listInboundEmailsForUser,
  markInboundEmailProcessedForUser,
  softDeleteInboundEmailForUser,
} from './inboundEmailService.js';
import { createTestDb, seedInboundEmail, seedTestUser } from './testDb.js';
import { contacts, inboundEmails } from '../db/schema.js';
import { createId, nowIso } from './id.js';
import { seedApplication } from './testDb.js';
import { eq } from 'drizzle-orm';

describe('inboundEmailBelongsToUser', () => {
  it('matches user email in to or from and contact emails', () => {
    const email = {
      id: '1',
      provider: 'postmark',
      subject: 'Hi',
      fromEmail: 'recruiter@acme.com',
      toEmail: 'seeker@example.com',
      receivedAt: '2026-07-01T09:00:00.000Z',
      payload: '{}',
      processed: false,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };

    expect(
      inboundEmailBelongsToUser(email, 'seeker@example.com', new Set()),
    ).toBe(true);
    expect(
      inboundEmailBelongsToUser(
        { ...email, fromEmail: 'seeker@example.com', toEmail: 'x@y.com' },
        'seeker@example.com',
        new Set(),
      ),
    ).toBe(true);
    expect(
      inboundEmailBelongsToUser(email, 'seeker@example.com', new Set(['recruiter@acme.com'])),
    ).toBe(true);
    expect(
      inboundEmailBelongsToUser(email, 'other@example.com', new Set()),
    ).toBe(false);
  });
});

describe('inbound email service', () => {
  it('lists newest first and excludes other users', () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });

    seedInboundEmail(db, {
      id: 'older',
      toEmail: 'seeker@example.com',
      receivedAt: '2026-07-01T08:00:00.000Z',
    });
    seedInboundEmail(db, {
      id: 'newer',
      toEmail: 'seeker@example.com',
      receivedAt: '2026-07-02T08:00:00.000Z',
    });
    seedInboundEmail(db, {
      id: 'other-user',
      toEmail: 'other@example.com',
    });

    const result = listInboundEmailsForUser(db, userId);
    expect(result.total).toBe(2);
    expect(result.items.map((e) => e.id)).toEqual(['newer', 'older']);
  });

  it('returns detail bodies and updates processed flag', () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    seedApplication(db, userId);

    const emailId = seedInboundEmail(db, {
      id: 'detail-email',
      toEmail: 'seeker@example.com',
      payload: JSON.stringify({
        TextBody: 'Body text',
        HtmlBody: '<b>Body html</b>',
      }),
    });

    const detail = getInboundEmailDetailForUser(db, userId, emailId);
    expect(detail?.textBody).toBe('Body text');
    expect(detail?.htmlBody).toBe('<b>Body html</b>');

    const updated = markInboundEmailProcessedForUser(db, userId, emailId, true);
    expect(updated?.processed).toBe(true);

    const filtered = listInboundEmailsForUser(db, userId, { processed: false });
    expect(filtered.total).toBe(0);
  });

  it('matches emails from known contacts', () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });
    seedApplication(db, userId);

    const ts = nowIso();
    db.insert(contacts)
      .values({
        id: createId(),
        userId,
        applicationId: 'app-1',
        name: 'Recruiter',
        email: 'jobs@corp.com',
        linkedIn: '',
        messageNotes: '',
        nextAction: '',
        createdAt: ts,
        updatedAt: ts,
      })
      .run();

    seedInboundEmail(db, {
      id: 'from-contact',
      fromEmail: 'jobs@corp.com',
      toEmail: 'inbound@postmark.com',
    });

    const result = listInboundEmailsForUser(db, userId);
    expect(result.total).toBe(1);
    expect(result.items[0].fromEmail).toBe('jobs@corp.com');
  });

  it('soft deletes email and excludes it from lists and detail', () => {
    const db = createTestDb();
    const userId = seedTestUser(db, { email: 'seeker@example.com' });

    const emailId = seedInboundEmail(db, {
      id: 'to-delete',
      toEmail: 'seeker@example.com',
    });
    seedInboundEmail(db, {
      id: 'keep',
      toEmail: 'seeker@example.com',
    });

    expect(softDeleteInboundEmailForUser(db, userId, emailId)).toBe(true);

    const list = listInboundEmailsForUser(db, userId);
    expect(list.total).toBe(1);
    expect(list.items[0].id).toBe('keep');

    expect(getInboundEmailDetailForUser(db, userId, emailId)).toBeNull();
    expect(softDeleteInboundEmailForUser(db, userId, emailId)).toBe(false);

    const row = db
      .select()
      .from(inboundEmails)
      .where(eq(inboundEmails.id, emailId))
      .all()[0];
    expect(row.deletedAt).toBeTruthy();
  });

  it('does not soft delete emails belonging to other users', () => {
    const db = createTestDb();
    seedTestUser(db, { email: 'seeker@example.com' });
    const otherUserId = seedTestUser(db, {
      id: 'user-other',
      email: 'other@example.com',
    });

    const emailId = seedInboundEmail(db, {
      id: 'other-email',
      toEmail: 'seeker@example.com',
    });

    expect(softDeleteInboundEmailForUser(db, otherUserId, emailId)).toBe(false);
    expect(getInboundEmailDetailForUser(db, otherUserId, emailId)).toBeNull();
  });
});
