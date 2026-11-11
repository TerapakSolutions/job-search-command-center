/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import ContactsPage from './ContactsPage';
import type { Contact } from '../types/contact';

const base: Omit<Contact, 'id' | 'name' | 'email' | 'company' | 'applicationId'> = {
  linkedIn: '',
  phone: null,
  title: null,
  source: 'email',
  lastContactDate: null,
  messageNotes: '',
  nextAction: '',
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
};

const storeState = {
  contacts: [
    { ...base, id: 'c1', name: 'Alex Rivera', email: 'alex.rivera@examplegrocer.example', company: 'Example Grocer Technologies', applicationId: 'app-grocer' },
    // Saved under their recruiting firm, but linked to the Example Grocer application.
    { ...base, id: 'c2', name: 'Sam Lee', email: 'sam@talentfirm.example', company: 'Talentfirm', applicationId: 'app-grocer' },
    { ...base, id: 'c3', name: 'Priya Nair', email: 'priya.nair@vendortwo.example', company: 'Vendor Two', applicationId: null, title: 'US IT Recruiter' },
  ] as Contact[],
  applications: [{ id: 'app-grocer', company: 'Example Grocer', roleTitle: 'Senior Engineering Manager' }],
  addContact: jest.fn(),
  updateContact: jest.fn(),
  deleteContact: jest.fn(),
};

jest.mock('../store/useJobSearchStore', () => ({
  useJobSearchStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

const visibleNames = () =>
  ['Alex Rivera', 'Sam Lee', 'Priya Nair'].filter((name) => screen.queryByText(name) !== null);

const search = (value: string) =>
  fireEvent.change(screen.getByRole('searchbox', { name: /filter contacts/i }), { target: { value } });

describe('Contacts filter', () => {
  it('shows everyone until you type', () => {
    render(<ContactsPage />);
    expect(visibleNames()).toEqual(['Alex Rivera', 'Sam Lee', 'Priya Nair']);
  });

  it('filters by company, including the linked application, ignoring case', () => {
    render(<ContactsPage />);
    search('GROCER');
    expect(visibleNames()).toEqual(['Alex Rivera', 'Sam Lee']);
  });

  it('filters by name, email and title', () => {
    render(<ContactsPage />);
    search('priya');
    expect(visibleNames()).toEqual(['Priya Nair']);
    search('talentfirm.example');
    expect(visibleNames()).toEqual(['Sam Lee']);
    search('it recruiter');
    expect(visibleNames()).toEqual(['Priya Nair']);
  });

  it('says so when nothing matches', () => {
    render(<ContactsPage />);
    search('nobody');
    expect(visibleNames()).toEqual([]);
    expect(screen.getByText(/no contacts match/i)).toBeTruthy();
  });
});
