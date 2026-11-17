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

const PROMPT = 'This date has passed — follow up or update the next step.';

function renderPage() {
  render(
    <MemoryRouter>
      <TodayPage />
    </MemoryRouter>,
  );
}

function liveItems(): HTMLElement[] {
  const list = within(contactSection()).getByRole('list', { name: 'Contact next actions' });
  return within(list).getAllByRole('listitem');
}

function itemFor(name: string): HTMLElement {
  return within(contactSection()).getByText(name).closest('li')!;
}

describe('TodayPage contact next actions — past-dated actions stay live', () => {
  it('keeps an action whose only date has passed in the live list, first, badged and prompted', () => {
    mockContacts = [
      contact('c-undated', 'Bram Ketteridge', 'Send the portfolio link'),
      contact('c-future', 'Ines Vardamir', `Prepare for the panel on ${longDate(3)}.`),
      contact('c-past', 'Orla Penhallow', `Confirm the onsite for ${longDate(-4)}.`),
    ];
    renderPage();
    const section = contactSection();

    // The heading counts every meaningful next action, past-dated included.
    expect(
      within(section).getByRole('heading', { name: 'Contact next actions (3)' }),
    ).not.toBeNull();

    const items = liveItems();
    expect(items).toHaveLength(3);
    // Past-dated first; the rest keep their existing order.
    expect(items.map((li) => li.querySelector('p')!.textContent)).toEqual([
      'Orla Penhallow',
      'Bram Ketteridge',
      'Ines Vardamir',
    ]);

    const past = itemFor('Orla Penhallow');
    expect(within(past).getByText('Date passed')).not.toBeNull();
    expect(past.textContent).toContain(PROMPT);
    // The stored text is still shown verbatim.
    expect(past.textContent).toContain(`Confirm the onsite for ${longDate(-4)}.`);
    const update = within(past).getByRole('link', { name: 'update' });
    expect(update.getAttribute('href')).toBe('/contacts');
  });

  it('does not badge or prompt undated and future-dated actions', () => {
    mockContacts = [
      contact('c-undated', 'Bram Ketteridge', 'Send the portfolio link'),
      contact('c-future', 'Ines Vardamir', `Prepare for the panel on ${longDate(3)}.`),
    ];
    renderPage();
    for (const name of ['Bram Ketteridge', 'Ines Vardamir']) {
      const item = itemFor(name);
      expect(within(item).queryByText('Date passed')).toBeNull();
      expect(item.textContent).not.toContain('This date has passed');
    }
    expect(liveItems().map((li) => li.querySelector('p')!.textContent)).toEqual([
      'Bram Ketteridge',
      'Ines Vardamir',
    ]);
  });

  it('renders no separate "Past dates" group', () => {
    mockContacts = [contact('c-past', 'Orla Penhallow', `Confirm the onsite for ${longDate(-4)}.`)];
    renderPage();
    const section = contactSection();
    expect(within(section).queryByText(/Past dates/)).toBeNull();
    expect(within(section).queryByTestId('past-dated-next-actions')).toBeNull();
    expect(section.querySelector('details')).toBeNull();
    expect(
      within(section).getByRole('heading', { name: 'Contact next actions (1)' }),
    ).not.toBeNull();
    expect(within(section).queryByText('No contact follow-ups logged.')).toBeNull();
  });

  it('does not mark an action dated today', () => {
    mockContacts = [contact('c-today', 'Tamsin Oakhurst', `Call at noon on ${longDate(0)}`)];
    renderPage();
    const item = itemFor('Tamsin Oakhurst');
    expect(within(item).queryByText('Date passed')).toBeNull();
    expect(item.textContent).not.toContain('This date has passed');
    expect(liveItems()).toHaveLength(1);
  });

  it('shows the empty line when no contact has a next action', () => {
    mockContacts = [];
    renderPage();
    expect(
      within(contactSection()).getByText('No contact follow-ups logged.'),
    ).not.toBeNull();
  });
});
