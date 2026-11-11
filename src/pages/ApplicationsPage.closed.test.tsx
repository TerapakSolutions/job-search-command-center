/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import ApplicationsPage from './ApplicationsPage';
import type { Application, PipelineStatus } from '../types/application';

jest.mock('../store/useJobSearchStore', () => ({
  useJobSearchStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      applications: mockApps,
      interviews: [],
      refreshData: jest.fn(),
    }),
}));

function app(id: string, company: string, status: PipelineStatus): Application {
  return {
    id,
    company,
    roleTitle: 'Engineer',
    jobUrl: '',
    workLocationType: 'remote',
    location: '',
    salaryMin: null,
    salaryMax: null,
    dateApplied: null,
    status,
    notes: '',
    interviewDate: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

const mockApps = [
  app('a1', 'Active Co', 'applied'),
  app('a2', 'Rejected Co', 'rejected'),
  app('a3', 'Ghosted Co', 'ghosted'),
];

const shown = () => ['Active Co', 'Rejected Co', 'Ghosted Co'].filter((c) => screen.queryByText(c));

describe('Applications: rejected and archived', () => {
  it('are hidden by default', () => {
    render(<ApplicationsPage />);
    expect(shown()).toEqual(['Active Co']);
  });

  it('come back with the toggle, which says how many', () => {
    render(<ApplicationsPage />);
    fireEvent.click(screen.getByRole('checkbox', { name: /show rejected & archived \(2\)/i }));
    expect(shown()).toEqual(['Active Co', 'Rejected Co', 'Ghosted Co']);
  });

  it('show when you pick that status', () => {
    render(<ApplicationsPage />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rejected' } });
    expect(shown()).toEqual(['Rejected Co']);
  });
});
