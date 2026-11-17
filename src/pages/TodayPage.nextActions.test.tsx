/** @jest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TodayPage from './TodayPage';
import type { Contact } from '../types/contact';

jest.mock('../components/DailyBriefingPanel', () => () => null);
jest.mock('../components/AutomationDashboardPanel', () => () => null);
jest.mock('../components/GoalsProgressPanel', () => () => null);

// Dates are relative to the real clock so the page (which uses "now") agrees
// with the fixtures. Names and companies are invented.
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
function longDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function contact(id: string, name: string, nextAction: string): Contact {
  return {
    id,
    applicationId: null,
    name,
    email: `${id}@example.test`,
    linkedIn: '',
    company: 'Quillfern Labs',
    source: 'email',
    lastContactDate: null,
    messageNotes: '',
    nextAction,
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-01T00:00:00.000Z',
  };
}

let mockContacts: Contact[] = [];
// Stable references: a fresh [] per selector call re-runs the page effects forever.
const mockEmpty: never[] = [];
const mockRefresh = jest.fn().mockResolvedValue(undefined);

jest.mock('../store/useJobSearchStore', () => ({
  useJobSearchStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      applications: mockEmpty,
      contacts: mockContacts,
      interviews: mockEmpty,
      refreshData: mockRefresh,
    }),
}));

function contactSection(): HTMLElement {
  return screen.getByRole('heading', { name: /Contact next actions/ }).closest('section')!;
}

describe('TodayPage contact next actions — out-of-date dated actions', () => {
  it('moves an action whose only date has passed into the past group, marked "Date passed"', () => {
    mockContacts = [
      contact('c-past', 'Orla Penhallow', `Confirm the onsite for ${longDate(-4)}.`),
      contact('c-undated', 'Bram Ketteridge', 'Send the portfolio link'),
      contact('c-future', 'Ines Vardamir', `Prepare for the panel on ${longDate(3)}.`),
    ];
    render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>,
    );
    const section = contactSection();

    expect(
      within(section).getByRole('heading', { name: 'Contact next actions (2)' }),
    ).not.toBeNull();

    const live = within(section).getByRole('list', { name: 'Live contact next actions' });
    expect(within(live).getByText('Bram Ketteridge')).not.toBeNull();
    expect(within(live).getByText('Ines Vardamir')).not.toBeNull();
    expect(within(live).queryByText('Orla Penhallow')).toBeNull();
    expect(within(live).queryByText('Date passed')).toBeNull();

    const past = within(section).getByTestId('past-dated-next-actions');
    expect(within(past).getByText('Past dates (1)')).not.toBeNull();
    const pastItem = within(past).getByText('Orla Penhallow').closest('li')!;
    expect(within(pastItem).getByText('Date passed')).not.toBeNull();
    // The stored text is still shown verbatim.
    expect(pastItem.textContent).toContain(`Confirm the onsite for ${longDate(-4)}.`);
    expect(within(past).queryByText('Bram Ketteridge')).toBeNull();
    expect(within(past).queryByText('Ines Vardamir')).toBeNull();
  });

  it('keeps an action dated today live', () => {
    mockContacts = [contact('c-today', 'Tamsin Oakhurst', `Call at noon on ${longDate(0)}`)];
    render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>,
    );
    const section = contactSection();
    const live = within(section).getByRole('list', { name: 'Live contact next actions' });
    expect(within(live).getByText('Tamsin Oakhurst')).not.toBeNull();
    expect(within(section).queryByTestId('past-dated-next-actions')).toBeNull();
  });

  it('still shows the past group when every action is out of date', () => {
    mockContacts = [contact('c-past', 'Orla Penhallow', `Confirm the onsite for ${longDate(-4)}.`)];
    render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>,
    );
    const section = contactSection();
    expect(
      within(section).getByRole('heading', { name: 'Contact next actions (0)' }),
    ).not.toBeNull();
    const past = within(section).getByTestId('past-dated-next-actions');
    expect(within(past).getByText('Orla Penhallow')).not.toBeNull();
  });
});
