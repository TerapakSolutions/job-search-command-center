/** @jest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TodayPage from './TodayPage';
import type { Contact } from '../types/contact';

jest.mock('../components/DailyBriefingPanel', () => () => null);
jest.mock('../components/AutomationDashboardPanel', () => () => null);
jest.mock('../components/GoalsProgressPanel', () => () => null);

// The page reads "now" from the clock, so the clock is pinned: tests never depend
// on the real date or cross midnight. Only Date is faked; timers stay real so the
// page's async metrics load still settles. Names, companies and dates are invented.
const NOW = new Date(2026, 10, 17, 9, 0); // Tue Nov 17, 2026, 9:00 local

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: [
      'nextTick',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
    ],
  });
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

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

function lead(item: HTMLElement): string | null {
  return item.querySelector('[data-testid="next-action-lead"]')?.textContent ?? null;
}

function badge(item: HTMLElement): HTMLElement | null {
  return item.querySelector('[data-testid="follow-up-badge"]');
}

function names(): string[] {
  return liveItems().map((li) => li.querySelector('p')!.textContent!);
}

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
  it('keeps an action whose only date has passed in the live list, first, badged, as a follow-up', () => {
    mockContacts = [
      contact('c-undated', 'Bram Ketteridge', 'Send the portfolio link'),
      contact('c-future', 'Ines Vardamir', 'Prepare for the panel on November 20, 2026.'),
      contact('c-past', 'Orla Penhallow', 'Confirm the onsite for November 13, 2026.'),
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
    expect(badge(past)?.textContent).toBe('Follow up soon');
    // The follow-up leads; the stale "Confirm ..." text does not.
    expect(lead(past)).toBe('Follow up on the onsite from Nov 13.');
    // Fri Nov 13 + 3 business days = Wed Nov 18.
    expect(past.textContent).toContain('Follow-up due in 1 business day');
    // #109's prompt is replaced, not shown alongside.
    expect(past.textContent).not.toContain('This date has passed');
    // The stored text is still shown verbatim, labelled "Was:".
    expect(within(past).getByText('Was: Confirm the onsite for November 13, 2026.')).not.toBeNull();
    const update = within(past).getByRole('link', { name: 'update' });
    expect(update.getAttribute('href')).toBe('/contacts');
  });

  it('does not badge or prompt undated and future-dated actions', () => {
    mockContacts = [
      contact('c-undated', 'Bram Ketteridge', 'Send the portfolio link'),
      contact('c-future', 'Ines Vardamir', 'Prepare for the panel on November 20, 2026.'),
    ];
    renderPage();
    for (const [name, text] of [
      ['Bram Ketteridge', 'Send the portfolio link'],
      ['Ines Vardamir', 'Prepare for the panel on November 20, 2026.'],
    ]) {
      const item = itemFor(name);
      expect(badge(item)).toBeNull();
      expect(lead(item)).toBeNull();
      expect(item.textContent).not.toContain('Follow up');
      expect(item.textContent).not.toContain('Follow-up');
      expect(item.textContent).not.toContain('Overdue');
      expect(item.textContent).not.toContain('Was:');
      expect(item.textContent).not.toContain('This date has passed');
      // The stored text is shown as-is, unprefixed.
      expect(within(item).getByText(text)).not.toBeNull();
    }
    expect(liveItems().map((li) => li.querySelector('p')!.textContent)).toEqual([
      'Bram Ketteridge',
      'Ines Vardamir',
    ]);
  });

  it('renders no separate "Past dates" group', () => {
    mockContacts = [contact('c-past', 'Orla Penhallow', 'Confirm the onsite for November 13, 2026.')];
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
    mockContacts = [contact('c-today', 'Tamsin Oakhurst', 'Call at noon on November 17, 2026')];
    renderPage();
    const item = itemFor('Tamsin Oakhurst');
    expect(badge(item)).toBeNull();
    expect(lead(item)).toBeNull();
    expect(item.textContent).not.toContain('Follow-up');
    expect(item.textContent).not.toContain('Overdue');
    expect(item.textContent).not.toContain('Was:');
    expect(item.textContent).not.toContain('This date has passed');
    expect(liveItems()).toHaveLength(1);
  });

  it('leads a past-dated meeting with the follow-up, not "Confirm attendance"', () => {
    mockContacts = [
      contact('c-meet', 'Wren Calloway', 'Confirm attendance for the meeting on Nov 13.'),
      contact('c-undated', 'Bram Ketteridge', 'Send the portfolio link'),
    ];
    renderPage();
    const item = itemFor('Wren Calloway');
    expect(lead(item)).toBe('Follow up on the meeting from Nov 13.');
    expect(lead(item)).not.toContain('Confirm attendance');
    expect(
      within(item).getByText('Follow-up due in 1 business day', { exact: false }),
    ).not.toBeNull();
    expect(
      within(item).getByText('Was: Confirm attendance for the meeting on Nov 13.'),
    ).not.toBeNull();
    expect(badge(item)?.textContent).toBe('Follow up soon');
    expect(within(item).getByRole('link', { name: 'update' }).getAttribute('href')).toBe(
      '/contacts',
    );
    expect(names()).toEqual(['Wren Calloway', 'Bram Ketteridge']);
  });

  it('orders past-dated items most overdue first, then due today, then due later', () => {
    // Today is Tue Nov 17. Events get +3 business days: Fri Nov 13 -> Wed Nov 18
    // (in 1), Thu Nov 12 -> Tue Nov 17 (today), Tue Nov 10 -> Fri Nov 13 (overdue
    // by 2 business days). The deadline (no event word) counts business days from
    // its own date: Tue Nov 10 -> overdue by 5 business days.
    mockContacts = [
      contact('c-undated', 'Bram Ketteridge', 'Send the portfolio link'),
      contact('c-later', 'Lark Fenwright', 'Coffee on Nov 13'),
      contact('c-today', 'Mira Thistlewood', 'Demo on Nov 12'),
      contact('c-future', 'Ines Vardamir', 'Prepare for the panel on November 20, 2026.'),
      contact('c-most', 'Corin Ashdale', 'Send the deck by Nov 10'),
      contact('c-over', 'Orla Penhallow', 'Interview on Nov 10'),
    ];
    renderPage();
    expect(names()).toEqual([
      'Corin Ashdale',
      'Orla Penhallow',
      'Mira Thistlewood',
      'Lark Fenwright',
      'Bram Ketteridge',
      'Ines Vardamir',
    ]);
    expect(itemFor('Corin Ashdale').textContent).toContain('Overdue by 5 business days');
    expect(itemFor('Corin Ashdale').textContent).not.toContain('Follow-up');
    expect(itemFor('Mira Thistlewood').textContent).toContain('Follow-up due today');
    expect(itemFor('Orla Penhallow').textContent).toContain(
      'Follow-up overdue by 2 business days',
    );
    expect(itemFor('Lark Fenwright').textContent).toContain('Follow-up due in 1 business day');
    expect(lead(itemFor('Corin Ashdale'))).toBe('Nov 10 has passed.');
  });

  it('shows a missed deadline as overdue from its own date, sorted with events', () => {
    mockContacts = [
      contact('c-meet', 'Wren Calloway', 'Confirm attendance for the meeting on Nov 13.'),
      contact('c-deadline', 'Sable Dunmore', 'Complete the assessment by Nov 14'),
      contact('c-undated', 'Bram Ketteridge', 'Send the portfolio link'),
    ];
    renderPage();
    const deadline = itemFor('Sable Dunmore');
    expect(lead(deadline)).toBe('Nov 14 has passed.');
    expect(deadline.textContent).toContain('Overdue by 2 business days — update the next step.');
    expect(deadline.textContent).not.toContain('Follow-up due today');
    expect(deadline.textContent).not.toContain('Follow up');
    expect(within(deadline).getByText('Was: Complete the assessment by Nov 14')).not.toBeNull();
    expect(badge(deadline)?.textContent).toBe('Overdue');
    // Deadline overdue by 2 business days; the meeting follow-up is due Wed Nov 18 (in 1 business day).
    expect(names()).toEqual(['Sable Dunmore', 'Wren Calloway', 'Bram Ketteridge']);
    expect(itemFor('Wren Calloway').textContent).toContain('Follow-up due in 1 business day');
  });

  it('keeps contact order among past-dated items due on the same day', () => {
    mockContacts = [
      contact('c-a', 'Pell Marrowind', 'Chat on Nov 13'),
      contact('c-b', 'Quinn Elsworth', 'Send the deck by Nov 10'),
      contact('c-c', 'Rook Haverleigh', 'Panel on Nov 13'),
    ];
    renderPage();
    expect(names()).toEqual(['Quinn Elsworth', 'Pell Marrowind', 'Rook Haverleigh']);
  });

  it('shows the empty line when no contact has a next action', () => {
    mockContacts = [];
    renderPage();
    expect(
      within(contactSection()).getByText('No contact follow-ups logged.'),
    ).not.toBeNull();
  });
});

describe('TodayPage contact next actions — the badge says where the follow-up stands', () => {
  // Today is Tue Nov 17; follow-ups are due 3 business days after an event.
  function expectNoDatePassed() {
    expect(document.body.textContent).not.toContain('Date passed');
  }

  it('event, follow-up due later: "Follow up soon", not in a warning colour', () => {
    // Fri Nov 13 + 3 business days = Wed Nov 18: due in 1 business day.
    mockContacts = [contact('c-later', 'Lark Fenwright', 'Coffee on Nov 13')];
    renderPage();
    const item = itemFor('Lark Fenwright');
    const b = badge(item);
    expect(b?.textContent).toBe('Follow up soon');
    expect(b?.className).not.toMatch(/\b(red|amber)-/);
    expect(b?.className).toMatch(/\bblue-/);
    expect(item.textContent).toContain('Follow-up due in 1 business day');
    expectNoDatePassed();
  });

  it('event, follow-up due today: "Follow up today", amber', () => {
    // Thu Nov 12 + 3 business days = Tue Nov 17.
    mockContacts = [contact('c-today', 'Mira Thistlewood', 'Demo on Nov 12')];
    renderPage();
    const item = itemFor('Mira Thistlewood');
    const b = badge(item);
    expect(b?.textContent).toBe('Follow up today');
    expect(b?.className).toMatch(/\bamber-/);
    expect(b?.className).not.toMatch(/\bred-/);
    expect(item.textContent).toContain('Follow-up due today');
    expectNoDatePassed();
  });

  it('event, follow-up overdue: "Follow-up overdue", red', () => {
    // Tue Nov 10 + 3 business days = Fri Nov 13: overdue by 2 business days.
    mockContacts = [contact('c-over', 'Orla Penhallow', 'Interview on Nov 10')];
    renderPage();
    const item = itemFor('Orla Penhallow');
    const b = badge(item);
    expect(b?.textContent).toBe('Follow-up overdue');
    expect(b?.className).toMatch(/\bred-/);
    expect(item.textContent).toContain('Follow-up overdue by 2 business days');
    expectNoDatePassed();
  });

  it('missed deadline: "Overdue", red', () => {
    mockContacts = [contact('c-deadline', 'Sable Dunmore', 'Complete the assessment by Nov 14')];
    renderPage();
    const item = itemFor('Sable Dunmore');
    const b = badge(item);
    expect(b?.textContent).toBe('Overdue');
    expect(b?.className).toMatch(/\bred-/);
    expect(item.textContent).toContain('Overdue by 2 business days');
    expectNoDatePassed();
  });

  it('badges undated and future-dated actions not at all', () => {
    mockContacts = [
      contact('c-undated', 'Bram Ketteridge', 'Send the portfolio link'),
      contact('c-future', 'Ines Vardamir', 'Prepare for the panel on November 20, 2026.'),
    ];
    renderPage();
    for (const item of liveItems()) expect(badge(item)).toBeNull();
    expect(contactSection().querySelectorAll('[data-testid="follow-up-badge"]')).toHaveLength(0);
    expectNoDatePassed();
  });

  it('renders a mixed list: deadline, overdue meeting, meeting due later', () => {
    mockContacts = [
      contact('c-a', 'Juniper Ashcombe', 'Follow up after the meeting on Nov 13'),
      contact('c-b', 'Calder Wynmoor', 'Send thank-you notes after the meeting on Nov 11'),
      contact('c-c', 'Odile Ferncastle', 'Return the signed forms by Nov 14'),
    ];
    renderPage();
    const rows = liveItems().map((li) => ({
      name: li.querySelector('p')!.textContent,
      badge: badge(li)?.textContent ?? null,
      lead: lead(li),
    }));
    expect(rows).toEqual([
      { name: 'Odile Ferncastle', badge: 'Overdue', lead: 'Nov 14 has passed.' },
      { name: 'Calder Wynmoor', badge: 'Follow-up overdue', lead: 'Follow up on the meeting from Nov 11.' },
      { name: 'Juniper Ashcombe', badge: 'Follow up soon', lead: 'Follow up on the meeting from Nov 13.' },
    ]);
    expect(itemFor('Odile Ferncastle').textContent).toContain('Overdue by 2 business days');
    expect(itemFor('Calder Wynmoor').textContent).toContain('Follow-up overdue by 1 business day');
    expect(itemFor('Juniper Ashcombe').textContent).toContain('Follow-up due in 1 business day');
    expectNoDatePassed();
  });
});
