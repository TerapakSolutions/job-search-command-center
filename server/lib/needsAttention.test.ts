/** @jest-environment node */
import { communications } from '../db/schema.js';
import { getAutomationDashboardSummary } from './emailAutomationService.js';
import { createTestDb, seedApplication, seedTestUser } from './testDb.js';

const DAY = 24 * 60 * 60 * 1000;

function seedCommunication(
  db: ReturnType<typeof createTestDb>,
  userId: string,
  applicationId: string,
  occurredAt: string,
) {
  db.insert(communications)
    .values({
      id: `comm-${applicationId}`,
      userId,
      applicationId,
      channel: 'email',
      direction: 'inbound',
      subject: 'Interview Request',
      body: '',
      occurredAt,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    })
    .run();
}

const flagged = (db: ReturnType<typeof createTestDb>, userId: string) =>
  getAutomationDashboardSummary(db, userId).attentionApplications.map((a) => a.applicationId);

describe('applications needing attention (R6)', () => {
  it('skips an active application with recruiter activity in the last 3 days', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId, { id: 'app-recent', status: 'recruiter_screen' });
    seedCommunication(db, userId, 'app-recent', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

    expect(flagged(db, userId)).not.toContain('app-recent');
  });

  it('still flags an active application with no activity for 4 days', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId, { id: 'app-quiet', status: 'interviewing' });
    seedCommunication(db, userId, 'app-quiet', new Date(Date.now() - 4 * DAY).toISOString());

    const summary = getAutomationDashboardSummary(db, userId);
    const entry = summary.attentionApplications.find((a) => a.applicationId === 'app-quiet');
    expect(entry?.reason).toBe('Active pipeline stage — check for recent recruiter emails');
  });

  it('still flags an active application with no communications at all', () => {
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId, { id: 'app-none', status: 'recruiter_screen' });

    expect(flagged(db, userId)).toContain('app-none');
  });
});
