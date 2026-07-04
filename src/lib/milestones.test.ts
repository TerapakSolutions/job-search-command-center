import {
  detectNewMilestones,
  currentStatusMap,
  topMilestone,
} from './milestones';
import type { Application } from '../types/application';

function app(overrides: Partial<Application> & Pick<Application, 'id' | 'status'>): Application {
  return {
    company: 'Acme Corp',
    roleTitle: 'Engineer',
    jobUrl: '',
    workLocationType: 'remote',
    location: '',
    salaryMin: null,
    salaryMax: null,
    dateApplied: null,
    notes: '',
    interviewDate: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('detectNewMilestones', () => {
  it('fires when an application advances into a milestone status', () => {
    const apps = [app({ id: 'a', status: 'interviewing' })];
    const result = detectNewMilestones(apps, { a: 'applied' });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      applicationId: 'a',
      status: 'interviewing',
      label: 'Interview scheduled',
    });
  });

  it('does not fire for apps already in the milestone status (no transition)', () => {
    const apps = [app({ id: 'a', status: 'interviewing' })];
    expect(detectNewMilestones(apps, { a: 'interviewing' })).toHaveLength(0);
  });

  it('fires again on a further advance (interviewing -> final_round -> offer)', () => {
    const apps = [app({ id: 'a', status: 'final_round' })];
    expect(detectNewMilestones(apps, { a: 'interviewing' })[0].label).toBe(
      'Final round reached',
    );
    const offerApps = [app({ id: 'a', status: 'offer' })];
    expect(detectNewMilestones(offerApps, { a: 'final_round' })[0].label).toBe(
      'Offer received',
    );
  });

  it('does not fire on a backward move (offer -> interviewing)', () => {
    const apps = [app({ id: 'a', status: 'interviewing' })];
    expect(detectNewMilestones(apps, { a: 'offer' })).toHaveLength(0);
  });

  it('does not fire for non-milestone statuses (rejected, applied)', () => {
    const apps = [
      app({ id: 'a', status: 'rejected' }),
      app({ id: 'b', status: 'applied' }),
    ];
    expect(detectNewMilestones(apps, { a: 'interviewing', b: 'saved' })).toHaveLength(0);
  });

  it('fires for a newly-seen app that appears directly in a milestone status', () => {
    const apps = [app({ id: 'new', status: 'offer' })];
    expect(detectNewMilestones(apps, {})).toHaveLength(1);
  });
});

describe('currentStatusMap', () => {
  it('snapshots id -> status for all applications', () => {
    const apps = [app({ id: 'a', status: 'applied' }), app({ id: 'b', status: 'offer' })];
    expect(currentStatusMap(apps)).toEqual({ a: 'applied', b: 'offer' });
  });
});

describe('topMilestone', () => {
  it('returns the most advanced milestone when several fire at once', () => {
    const apps = [
      app({ id: 'a', status: 'interviewing' }),
      app({ id: 'b', status: 'offer' }),
    ];
    const detected = detectNewMilestones(apps, {});
    expect(topMilestone(detected)?.applicationId).toBe('b');
  });

  it('returns null for an empty list', () => {
    expect(topMilestone([])).toBeNull();
  });
});
