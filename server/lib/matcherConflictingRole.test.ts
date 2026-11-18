/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { applications, contacts } from '../db/schema.js';
import { matchEmailToApplications } from './emailApplicationMatcher.js';
import { applySafeAutomationRules } from './emailProcessingAutomation.js';
import { createId, nowIso } from './id.js';
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';

/**
 * An email that names a role is about that role. Sender-is-a-contact (+40)
 * plus exact company (+30) reached the 70 threshold on their own, so a
 * confirmation for a second role at the same company was attached to the
 * first application instead of creating a new one. An application whose
 * known role conflicts with the email's known role is not a candidate.
 */
const SENDER = 'recruiter@globex.example';

function seedAppWithContact(
  db: ReturnType<typeof createTestDb>,
  userId: string,
  overrides: { id: string; roleTitle: string; status?: string; dateApplied?: string | null },
) {
  const appId = seedApplication(db, userId, {
    id: overrides.id,
    company: 'Globex Corp',
    roleTitle: overrides.roleTitle,
    status: overrides.status ?? 'interviewing',
    dateApplied: overrides.dateApplied ?? '2026-06-02',
  });
  const ts = nowIso();
  db.insert(contacts)
    .values({
      id: createId(),
      userId,
      applicationId: appId,
      name: 'Pat Example',
      email: SENDER,
      linkedIn: '',
      messageNotes: '',
      nextAction: '',
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  return appId;
}

function match(
  db: ReturnType<typeof createTestDb>,
  userId: string,
  positionTitle: string | null,
  classification = 'Application Confirmation',
) {
  return matchEmailToApplications(db, userId, {
    inboundEmailId: createId(),
    fromEmail: SENDER,
    companyName: 'Globex Corp',
    positionTitle,
    recruiterName: null,
    classification,
  });
}

describe('matcher rejects an application whose role conflicts with the email', () => {
  it('does not match a known, different role at the same company even when the sender is a contact', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedAppWithContact(db, userId, { id: 'app-a', roleTitle: 'Director, Platform' });

    const result = match(db, userId, 'Manager, Data Engineering');

    expect(result.bestMatch).toBeNull();
  });

  it('creates a new applied application for a confirmation of a different role at the same company', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedAppWithContact(db, userId, { id: 'app-a', roleTitle: 'Director, Platform' });

    const emailId = seedInboundEmail(db, {
      fromEmail: SENDER,
      subject: 'Thank you for applying',
      classification: 'Application Confirmation',
      classificationConfidence: 95,
      companyName: 'Globex Corp',
      positionTitle: 'Manager, Data Engineering',
      receivedAt: '2026-07-15T19:00:00.000Z',
    });

    applySafeAutomationRules(db, userId, emailId);

    const apps = db.select().from(applications).where(eq(applications.userId, userId)).all();
    expect(apps).toHaveLength(2);
    const appA = apps.find((a) => a.id === 'app-a')!;
    expect(appA.status).toBe('interviewing');
    expect(appA.dateApplied).toBe('2026-06-02');
    const created = apps.find((a) => a.id !== 'app-a')!;
    expect(created.company).toBe('Globex Corp');
    expect(created.roleTitle).toBe('Manager, Data Engineering');
    expect(created.status).toBe('applied');
    expect(created.dateApplied).toBe('2026-07-15');
  });

  it('control: same company, same role, sender is a contact -> still matches', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedAppWithContact(db, userId, { id: 'app-a', roleTitle: 'Director, Platform' });

    expect(match(db, userId, 'Director, Platform').bestMatch?.applicationId).toBe('app-a');
  });

  it.each([null, 'Unknown role'])(
    'control: email role unknown (%p) -> company + contact still match',
    (positionTitle) => {
      const db = createTestDb();
      const userId = seedTestUser(db);
      seedAppWithContact(db, userId, { id: 'app-a', roleTitle: 'Director, Platform' });

      expect(match(db, userId, positionTitle).bestMatch?.applicationId).toBe('app-a');
    },
  );

  it('control: application role unknown -> still eligible', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedAppWithContact(db, userId, { id: 'app-a', roleTitle: 'Unknown role' });

    expect(
      match(db, userId, 'Manager, Data Engineering').bestMatch?.applicationId,
    ).toBe('app-a');
  });

  it('a rejection for a different role at the same company does not update the other application', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedAppWithContact(db, userId, { id: 'app-a', roleTitle: 'Director, Platform' });

    const emailId = seedInboundEmail(db, {
      fromEmail: SENDER,
      subject: 'An update on your application',
      classification: 'Rejection',
      classificationConfidence: 95,
      companyName: 'Globex Corp',
      positionTitle: 'Manager, Data Engineering',
      receivedAt: '2026-07-15T19:00:00.000Z',
    });

    applySafeAutomationRules(db, userId, emailId);

    const appA = db.select().from(applications).where(eq(applications.id, 'app-a')).all()[0];
    expect(appA.status).toBe('interviewing');
  });
});
