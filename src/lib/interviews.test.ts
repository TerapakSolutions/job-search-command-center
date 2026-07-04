import { upcomingInterviewAt } from './interviews';
import type { Interview } from '../types/interview';

function interview(overrides: Partial<Interview>): Interview {
  return {
    id: 'i1',
    applicationId: 'app-1',
    scheduledAt: '2026-07-07T22:00:00.000Z',
    type: 'video',
    location: '',
    notes: '',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('upcomingInterviewAt', () => {
  const now = new Date('2026-07-03T12:00:00.000Z');

  it('returns the soonest not-yet-past interview for the application', () => {
    const rows = [
      interview({ id: 'later', scheduledAt: '2026-07-10T18:00:00.000Z' }),
      interview({ id: 'sooner', scheduledAt: '2026-07-07T22:00:00.000Z' }),
    ];
    expect(upcomingInterviewAt(rows, 'app-1', now)).toBe('2026-07-07T22:00:00.000Z');
  });

  it('ignores past interviews and other applications', () => {
    const rows = [
      interview({ id: 'past', scheduledAt: '2026-06-01T18:00:00.000Z' }),
      interview({ id: 'other-app', applicationId: 'app-2' }),
    ];
    expect(upcomingInterviewAt(rows, 'app-1', now)).toBeNull();
  });

  it('returns null when no interviews exist', () => {
    expect(upcomingInterviewAt([], 'app-1', now)).toBeNull();
  });
});
