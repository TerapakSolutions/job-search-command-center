/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import ApplicationCard from './ApplicationCard';
import ApplicationForm from './ApplicationForm';
import type { Application } from '../types/application';

jest.mock('../store/useJobSearchStore', () => ({
  useJobSearchStore: (selector: (s: { interviews: never[] }) => unknown) =>
    selector({ interviews: [] }),
}));

function app(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app-1',
    company: 'Client Co',
    roleTitle: 'Solution Architect',
    jobUrl: '',
    workLocationType: 'hybrid',
    location: 'Example City',
    salaryMin: null,
    salaryMax: null,
    payPeriod: null,
    employmentType: null,
    agency: null,
    submittedDate: null,
    dateApplied: null,
    status: 'recruiter_screen',
    notes: '',
    interviewDate: null,
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('ApplicationCard: contract details', () => {
  it('shows an hourly rate, engagement type, agency and submitted date', () => {
    render(
      <ApplicationCard
        application={app({
          salaryMin: 62.5,
          salaryMax: 62.5,
          payPeriod: 'hour',
          employmentType: 'w2_contract',
          agency: 'Acme Staffing',
          submittedDate: '2026-11-10',
        })}
      />,
    );
    expect(screen.getByText('$62.5/hr')).toBeTruthy();
    expect(screen.getByText('W2 contract · via Acme Staffing')).toBeTruthy();
    expect(screen.getByText(/^Submitted /)).toBeTruthy();
  });

  it('control: a yearly salary with no contract details renders as before', () => {
    const { container } = render(
      <ApplicationCard application={app({ salaryMin: 120000, salaryMax: 150000 })} />,
    );
    expect(screen.getByText('$120,000 – 150,000')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\/hr|via |Submitted|contract|C2C|1099|Full-time/);
  });
});

describe('ApplicationForm: contract details', () => {
  it('preloads the contract fields when editing and submits them back', () => {
    const onSubmit = jest.fn();
    render(
      <ApplicationForm
        initial={app({
          salaryMin: 65,
          salaryMax: 65,
          payPeriod: 'hour',
          employmentType: 'c2c',
          agency: 'Acme Staffing',
          submittedDate: '2026-11-10',
        })}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    expect((screen.getByLabelText('Pay period') as HTMLSelectElement).value).toBe('hour');
    expect((screen.getByLabelText('Engagement type') as HTMLSelectElement).value).toBe('c2c');
    expect((screen.getByLabelText('Staffing agency') as HTMLInputElement).value).toBe('Acme Staffing');
    expect((screen.getByLabelText('Date submitted') as HTMLInputElement).value).toBe('2026-11-10');

    fireEvent.change(screen.getByLabelText('Engagement type'), { target: { value: 'w2_contract' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        salaryMin: 65,
        payPeriod: 'hour',
        employmentType: 'w2_contract',
        agency: 'Acme Staffing',
        submittedDate: '2026-11-10',
      }),
    );
  });

  // Browsers reject 62.5 in a number input without step="any"; jsdom does
  // not model step validation, so check the attribute itself.
  it.each(['Pay min', 'Pay max'])('%s accepts a decimal hourly rate', (label) => {
    render(<ApplicationForm onSubmit={jest.fn()} onCancel={() => {}} />);
    expect(screen.getByLabelText(label).getAttribute('step')).toBe('any');
  });

  it('a new application submits the contract fields as empty', () => {
    const onSubmit = jest.fn();
    render(<ApplicationForm onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Company *'), { target: { value: 'Client Co' } });
    fireEvent.change(screen.getByLabelText('Role title *'), { target: { value: 'Architect' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add application' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ payPeriod: null, employmentType: null, agency: null, submittedDate: null }),
    );
  });
});
