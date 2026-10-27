/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { contacts, inboundEmails } from '../db/schema.js';
import { aggregateBriefingData } from './briefingAggregator.js';
import { createId } from './id.js';
import { listInboundEmailsForUser } from './inboundEmailService.js';
import { resolveUserIdForInboundEmail } from './inboundEmailUserResolver.js';
import { createTestDb, seedInboundEmail, seedTestUser } from './testDb.js';

// Several people share one inbound address, so every email must reach only
// the person it belongs to.

const TS = '2026-10-27T00:00:00.000Z';
const INBOUND = 'jobinfo@jobs.example.com';

function seedContact(db: ReturnType<typeof createTestDb>, userId: string, email: string) {
  db.insert(contacts)
    .values({
      id: createId(),
      userId,
      applicationId: null,
      name: 'Contact',
      email,
      linkedIn: '',
      messageNotes: '',
      nextAction: '',
      createdAt: TS,
      updatedAt: TS,
    })
    .run();
}

function seedRow(db: ReturnType<typeof createTestDb>, values: Parameters<typeof seedInboundEmail>[1]) {
  const id = seedInboundEmail(db, values);
  return db.select().from(inboundEmails).where(eq(inboundEmails.id, id)).get()!;
}

function listedIds(db: ReturnType<typeof createTestDb>, userId: string) {
  return listInboundEmailsForUser(db, userId).items.map((e) => e.id);
}

describe('inbound email isolation between users', () => {
  it("does not show one user's forwards to a user who saved them as a contact", () => {
    const db = createTestDb();
    const alex = seedTestUser(db, { id: 'alex', email: 'alex@example.com' });
    const blair = seedTestUser(db, { id: 'blair', email: 'blair@example.com' });
    seedContact(db, alex, 'blair@example.com');
    const row = seedRow(db, { id: 'blair-fwd', fromEmail: 'blair@example.com', toEmail: INBOUND });

    expect(listedIds(db, alex)).toEqual([]);
    expect(listedIds(db, blair)).toEqual(['blair-fwd']);
    expect(resolveUserIdForInboundEmail(db, row)).toBe(blair);
  });

  it('applies the same rule when the sender carries a display name', () => {
    const db = createTestDb();
    const alex = seedTestUser(db, { id: 'alex', email: 'alex@example.com' });
    const blair = seedTestUser(db, { id: 'blair', email: 'blair@example.com' });
    seedContact(db, alex, 'blair@example.com');
    const row = seedRow(db, { id: 'named', fromEmail: 'Blair <blair@example.com>', toEmail: INBOUND });

    expect(listedIds(db, alex)).toEqual([]);
    expect(listedIds(db, blair)).toEqual(['named']);
    expect(resolveUserIdForInboundEmail(db, row)).toBe(blair);
  });

  it('matches a recipient address exactly, not as a substring', () => {
    const db = createTestDb();
    const an = seedTestUser(db, { id: 'an', email: 'an@example.com' });
    const dan = seedTestUser(db, { id: 'dan', email: 'dan@example.com' });
    const row = seedRow(db, { id: 'to-dan', fromEmail: 'recruiter@acme.com', toEmail: 'Dan <dan@example.com>' });

    expect(listedIds(db, an)).toEqual([]);
    expect(listedIds(db, dan)).toEqual(['to-dan']);
    expect(resolveUserIdForInboundEmail(db, row)).toBe(dan);
  });

  it('still routes a recruiter email by its sender when no user address is on it', () => {
    const db = createTestDb();
    const alex = seedTestUser(db, { id: 'alex', email: 'alex@example.com' });
    seedTestUser(db, { id: 'blair', email: 'blair@example.com' });
    seedContact(db, alex, 'recruiter@acme.com');
    const row = seedRow(db, { id: 'direct', fromEmail: 'recruiter@acme.com', toEmail: INBOUND });

    expect(listedIds(db, alex)).toEqual(['direct']);
    expect(listedIds(db, 'blair')).toEqual([]);
    expect(resolveUserIdForInboundEmail(db, row)).toBe(alex);
  });

  it("keeps another user's recruiter email out of the daily brief", () => {
    const db = createTestDb();
    const alex = seedTestUser(db, { id: 'alex', email: 'alex@example.com' });
    const an = seedTestUser(db, { id: 'an', email: 'an@example.com' });
    seedContact(db, alex, 'blair@example.com');
    seedTestUser(db, { id: 'blair', email: 'blair@example.com' });
    const receivedAt = '2026-10-27T10:00:00.000Z';
    seedInboundEmail(db, { id: 'blair-fwd', fromEmail: 'blair@example.com', toEmail: INBOUND, receivedAt, classification: 'Recruiter Outreach' });
    seedInboundEmail(db, { id: 'to-dan', fromEmail: 'recruiter@acme.com', toEmail: 'dan@example.com', receivedAt, classification: 'Recruiter Outreach' });

    const now = new Date('2026-10-27T12:00:00.000Z');
    const ids = (userId: string) =>
      aggregateBriefingData(db, userId, now).newRecruiterEmails.map((e) => e.id);
    expect(ids(alex)).toEqual([]);
    expect(ids(an)).toEqual([]);
  });
});
