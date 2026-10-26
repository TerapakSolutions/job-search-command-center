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
  it.each<PipelineStatus>(['interviewing', 'final_round'])('is green for %s', (status) => {
    expect(cardClass(status)).toContain('bg-green-50');
  });

  it('is yellow for recruiter_screen', () => {
    expect(cardClass('recruiter_screen')).toContain('bg-yellow-50');
  });

  it.each<PipelineStatus>(['applied', 'saved', 'offer', 'rejected', 'ghosted'])(
    'has no colour for %s',
    (status) => {
      const className = cardClass(status);
      expect(className).toContain('bg-white');
      expect(className).not.toMatch(/bg-(green|yellow)-50/);
    },
  );

  it('is uncoloured when highlighting is off (Pipeline board)', () => {
    expect(cardClass('interviewing', false)).toContain('bg-white');
  });
});
