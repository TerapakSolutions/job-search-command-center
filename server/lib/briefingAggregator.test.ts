/** @jest-environment node */
import {
  aggregateBriefingData,
  getBriefingWindow,
} from './briefingAggregator.js';
import { createTestDb, seedApplication, seedTestUser } from './testDb.js';
import { communications, inboundEmails } from '../db/schema.js';
import { createId, nowIso } from './id.js';

describe('getBriefingWindow', () => {
  it('defaults to 24 hours when no previous briefing exists', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));

    const { start, end } = getBriefingWindow(null, new Date());
    expect(end.toISOString()).toBe('2026-07-01T12:00:00.000Z');
    expect(start.toISOString()).toBe('2026-06-30T12:00:00.000Z');

    jest.useRealTimers();
  });

  it('starts at previous briefing createdAt when available', () => {
    const now = new Date('2026-07-01T12:00:00.000Z');
    const { start } = getBriefingWindow('2026-06-28T08:00:00.000Z', now);
    expect(start.toISOString()).toBe('2026-06-28T08:00:00.000Z');
  });
});

describe('aggregateBriefingData', () => {
  it('aggregates pipeline stats and user-scoped activity', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));

    const db = createTestDb();
    const userId = seedTestUser(db);
    const otherUserId = seedTestUser(db, {
      id: 'user-other',
      email: 'other@example.com',
    });

    seedApplication(db, userId, {
      id: 'app-applied',
      status: 'applied',
      dateApplied: '2026-06-30',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
    });

    seedApplication(db, userId, {
      id: 'app-saved',
      status: 'saved',
      createdAt: '2026-07-01T06:00:00.000Z',
      updatedAt: '2026-07-01T06:00:00.000Z',
    });

    seedApplication(db, otherUserId, {
      id: 'app-other',
      company: 'Other Co',
    });

    const ts = nowIso();
    db.insert(communications)
      .values({
        id: createId(),
        userId,
        applicationId: 'app-applied',
        contactId: null,
        channel: 'email',
        direction: 'inbound',
        subject: 'Thanks for applying',
        body: 'We received your application',
        occurredAt: '2026-07-01T08:00:00.000Z',
        createdAt: ts,
        updatedAt: ts,
      })
      .run();

    db.insert(inboundEmails)
      .values({
        id: createId(),
        provider: 'postmark',
        subject: 'Interview invite',
        fromEmail: 'recruiter@acme.com',
        toEmail: 'seeker@example.com',
        receivedAt: '2026-07-01T09:00:00.000Z',
        payload: '{}',
        processed: false,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();

    const data = aggregateBriefingData(db, userId);

    expect(data.pipelineStats.total).toBe(2);
    expect(data.pipelineStats.byStatus.applied).toBe(1);
    expect(data.pipelineStats.byStatus.saved).toBe(1);
    expect(data.newRecruiterEmails.length).toBe(2);
    expect(data.applicationsSubmitted.length).toBe(1);
    expect(data.newOpportunities.length).toBe(1);
    expect(data.recommendations.length).toBeGreaterThan(0);
    expect(data.changesSincePrevious).toContain('First daily briefing for this account');

    jest.useRealTimers();
  });
});
