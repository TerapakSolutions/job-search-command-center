/** @jest-environment node */
import { createTestDb, seedApplication, seedInboundEmail, seedTestUser } from './testDb.js';
import { contacts } from '../db/schema.js';
import { createId, nowIso } from './id.js';
import {
  findDuplicateApplication,
  matchEmailToApplications,
} from './emailApplicationMatcher.js';

describe('emailApplicationMatcher', () => {
  it('matches by sender email linked to contact', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId, {
      id: 'app-1',
      company: 'Acme Corp',
      roleTitle: 'Software Engineer',
    });

    const ts = nowIso();
    db.insert(contacts)
      .values({
        id: createId(),
        userId,
        applicationId: 'app-1',
        name: 'Jane Recruiter',
        email: 'jane@acme.com',
        linkedIn: '',
        messageNotes: '',
        nextAction: '',
        createdAt: ts,
        updatedAt: ts,
      })
      .run();

    const result = matchEmailToApplications(db, userId, {
      fromEmail: 'jane@acme.com',
      companyName: 'Acme Corp',
      positionTitle: 'Software Engineer',
      recruiterName: 'Jane Recruiter',
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].applicationId).toBe('app-1');
    expect(result.matches[0].confidence).toBeGreaterThanOrEqual(70);
    expect(result.bestMatch?.applicationId).toBe('app-1');
    expect(result.requiresManualSelection).toBe(false);
  });

  it('requires manual selection when top matches are close', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId, {
      id: 'app-1',
      company: 'Acme Corp',
      roleTitle: 'Software Engineer',
    });
    seedApplication(db, userId, {
      id: 'app-2',
      company: 'Acme Corporation',
      roleTitle: 'Senior Software Engineer',
    });

    const result = matchEmailToApplications(db, userId, {
      fromEmail: 'unknown@other.com',
      companyName: 'Acme Corp',
      positionTitle: 'Software Engineer',
      recruiterName: null,
    });

    expect(result.matches.length).toBeGreaterThanOrEqual(2);
    expect(result.requiresManualSelection).toBe(true);
    expect(result.bestMatch).toBeNull();
  });

  it('detects duplicate applications by company and role', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId, {
      id: 'app-dup',
      company: 'Beta Inc',
      roleTitle: 'Product Manager',
    });

    const duplicateId = findDuplicateApplication(
      db,
      userId,
      'Beta Inc',
      'Product Manager',
    );
    expect(duplicateId).toBe('app-dup');
  });

  it('returns no matches for unrelated emails', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId, {
      company: 'Totally Different Co',
      roleTitle: 'Designer',
    });

    const result = matchEmailToApplications(db, userId, {
      fromEmail: 'hr@unknown.com',
      companyName: 'Unknown LLC',
      positionTitle: 'Analyst',
      recruiterName: null,
    });

    expect(result.matches).toHaveLength(0);
    expect(result.bestMatch).toBeNull();
  });
});
