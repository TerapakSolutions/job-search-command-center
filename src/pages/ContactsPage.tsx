import { useState } from 'react';
import { FiPlus } from 'react-icons/fi';
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

  const getCompanyLabel = (applicationId: string) => {
    const app = applications.find((a) => a.id === applicationId);
    return app ? `${app.company} — ${app.roleTitle}` : 'Unknown application';
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Communications</h2>
          <p className="mt-1 text-gray-600">
            Track recruiters and contacts linked to each application.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          disabled={applications.length === 0}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FiPlus className="mr-2" />
          Add contact
        </button>
      </div>

      {applications.length === 0 && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-4">
          Add an application first before logging contacts.
        </p>
      )}

      {contacts.length === 0 ? (
        <p className="text-center text-gray-500 py-12 bg-white border rounded-lg">
          No contacts logged yet.
        </p>
      ) : (
        <div className="space-y-3">
          {contacts.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              companyLabel={getCompanyLabel(contact.applicationId)}
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
