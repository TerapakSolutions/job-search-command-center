/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import ContactForm, { ContactRow } from './ContactForm';
import type { Contact } from '../types/contact';

jest.mock('../store/useJobSearchStore', () => ({
  useJobSearchStore: (selector: (s: { applications: never[] }) => unknown) =>
    selector({ applications: [] }),
}));

const contact: Contact = {
  id: 'c1',
  applicationId: null,
  name: 'Priya Nair',
  email: 'priya.nair@vendortwo.example',
  linkedIn: '',
  phone: '+1 555-0199',
  title: 'US IT Recruiter',
  company: 'Vendor Two',
  source: 'email',
  lastContactDate: null,
  messageNotes: '',
  nextAction: '',
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
};

describe('contact phone and title', () => {
  it('shows them on the contact card', () => {
    render(<ContactRow contact={contact} applications={[]} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('US IT Recruiter')).toBeTruthy();
    expect(screen.getByText('+1 555-0199')).toBeTruthy();
  });

  it('control: a contact without them renders no empty lines', () => {
    const { container } = render(
      <ContactRow contact={{ ...contact, phone: null, title: null }} applications={[]} onEdit={() => {}} onDelete={() => {}} />,
    );
    expect(container.textContent).not.toMatch(/US IT Recruiter|555-0199/);
  });

  it('edits and submits them', () => {
    const onSubmit = jest.fn();
    render(<ContactForm initial={contact} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByDisplayValue('+1 555-0199'), { target: { value: '555-0123' } });
    fireEvent.change(screen.getByDisplayValue('US IT Recruiter'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ phone: '555-0123', title: null }));
  });
});
