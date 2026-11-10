/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import ApplicationCard from './ApplicationCard';
import type { Application, PipelineStatus } from '../types/application';

jest.mock('../store/useJobSearchStore', () => ({
  useJobSearchStore: (selector: (s: { interviews: never[] }) => unknown) =>
    selector({ interviews: [] }),
}));

function app(status: PipelineStatus): Application {
  return {
    id: `app-${status}`,
    company: 'Acme',
    roleTitle: 'Engineer',
    jobUrl: '',
    workLocationType: 'remote',
    location: '',
    salaryMin: null,
    salaryMax: null,
    dateApplied: '2026-10-21',
    status,
    notes: '',
    interviewDate: null,
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
  };
}

function cardClass(status: PipelineStatus, highlightStatus = true): string {
  const { unmount } = render(
    <ApplicationCard application={app(status)} highlightStatus={highlightStatus} />,
  );
  const className = screen.getByRole('button').className;
  unmount();
  return className;
}

describe('ApplicationCard status colours', () => {
  // The fixture was last updated on 2026-10-21; pin "now" to that day so
  // these colour checks are not affected by the no-activity rule.
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-21T18:00:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  it.each<PipelineStatus>(['interviewing', 'final_round'])('is green for %s', (status) => {
    expect(cardClass(status)).toContain('bg-green-50');
  });

  it('is yellow for recruiter_screen', () => {
    expect(cardClass('recruiter_screen')).toContain('bg-yellow-50');
  });

  it('is red for rejected', () => {
    expect(cardClass('rejected')).toContain('bg-red-50');
  });

  it.each<PipelineStatus>(['applied', 'saved', 'offer', 'ghosted'])(
    'has no colour for %s',
    (status) => {
      const className = cardClass(status);
      expect(className).toContain('bg-white');
      expect(className).not.toMatch(/bg-(green|yellow|red|orange)-50/);
    },
  );

  it('is uncoloured when highlighting is off (Pipeline board)', () => {
    expect(cardClass('interviewing', false)).toContain('bg-white');
  });
});

// An active application with no update for 7+ days needs attention.
describe('ApplicationCard: no activity for a week', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-10T17:00:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  function render7(status: PipelineStatus, updatedAt: string, highlightStatus = true) {
    const { unmount } = render(
      <ApplicationCard application={{ ...app(status), updatedAt }} highlightStatus={highlightStatus} />,
    );
    const className = screen.getByRole('button').className;
    const text = screen.getByRole('button').textContent ?? '';
    unmount();
    return { className, text };
  }

  it.each<PipelineStatus>(['saved', 'applied', 'recruiter_screen', 'interviewing', 'final_round'])(
    'is orange for %s untouched for 7 days, and says so',
    (status) => {
      const { className, text } = render7(status, '2026-11-03T16:00:00.000Z');
      expect(className).toContain('bg-orange-50');
      expect(text).toContain('No activity in 7 days');
    },
  );

  it('is not orange at 6 days', () => {
    const { className, text } = render7('applied', '2026-11-04T18:00:00.000Z');
    expect(className).not.toContain('bg-orange-50');
    expect(text).not.toContain('No activity');
  });

  it.each<PipelineStatus>(['rejected', 'ghosted', 'offer'])('is never orange for %s', (status) => {
    const { className } = render7(status, '2026-10-01T00:00:00.000Z');
    expect(className).not.toContain('bg-orange-50');
  });

  it('stays red for an old rejection', () => {
    expect(render7('rejected', '2026-10-01T00:00:00.000Z').className).toContain('bg-red-50');
  });

  it('is uncoloured when highlighting is off (Pipeline board)', () => {
    const { className, text } = render7('applied', '2026-10-01T00:00:00.000Z', false);
    expect(className).toContain('bg-white');
    expect(text).not.toContain('No activity');
  });
});
