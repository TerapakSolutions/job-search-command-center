import { useMemo, useState } from 'react';
import { FiPlus, FiSearch } from 'react-icons/fi';
import ContactForm, { ContactRow } from '../components/ContactForm';
import Modal from '../components/Modal';
import { useJobSearchStore } from '../store/useJobSearchStore';
import type { Contact } from '../types/contact';

export default function ContactsPage() {
  const contacts = useJobSearchStore((s) => s.contacts);
  const applications = useJobSearchStore((s) => s.applications);
  const addContact = useJobSearchStore((s) => s.addContact);
  const updateContact = useJobSearchStore((s) => s.updateContact);
  const deleteContact = useJobSearchStore((s) => s.deleteContact);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [query, setQuery] = useState('');

  // Matches name, company, email, title and the linked application, so a
  // recruiter saved under their firm still shows up for the employer.
  const visibleContacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    const appLabel = new Map(applications.map((a) => [a.id, `${a.company} ${a.roleTitle}`]));
    return contacts.filter((c) =>
      [c.name, c.company, c.email, c.title ?? '', c.applicationId ? appLabel.get(c.applicationId) ?? '' : '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [contacts, applications, query]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Communications</h2>
          <p className="mt-1 text-gray-600">
            Track recruiters and contacts — linked to applications when available.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          <FiPlus className="mr-2" />
          Add contact
        </button>
      </div>

      {contacts.length > 0 && (
        <div className="relative">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            aria-label="Filter contacts"
            placeholder="Filter by name, company, email or application"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      {contacts.length === 0 ? (
        <p className="text-center text-gray-500 py-12 bg-white border rounded-lg">
          No contacts logged yet.
        </p>
      ) : visibleContacts.length === 0 ? (
        <p className="text-center text-gray-500 py-12 bg-white border rounded-lg">
          No contacts match “{query.trim()}”.
        </p>
      ) : (
        <div className="space-y-3">
          {visibleContacts.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              applications={applications}
              onEdit={() => {
                setEditing(contact);
                setModalOpen(true);
              }}
              onDelete={() => {
                if (window.confirm(`Delete contact ${contact.name}?`)) {
                  deleteContact(contact.id);
                }
              }}
            />
          ))}
        </div>
      )}

      <Modal
        title={editing ? 'Edit contact' : 'New contact'}
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
      >
        <ContactForm
          initial={editing}
          onSubmit={(input) => {
            if (editing) {
              updateContact(editing.id, input);
            } else {
              addContact(input);
            }
            setModalOpen(false);
            setEditing(null);
          }}
          onCancel={() => {
            setModalOpen(false);
            setEditing(null);
          }}
        />
      </Modal>
    </div>
  );
}
