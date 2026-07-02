import { useEffect, useState } from 'react';
import type { Contact, ContactInput } from '../types/contact';
import { useJobSearchStore } from '../store/useJobSearchStore';
import { formatDate } from '../lib/dates';
import {
  contactApplicationLabel,
  contactSourceLabel,
  isMeaningfulContactNextAction,
} from '../lib/contactDisplay';

interface ContactFormProps {
  initial?: Contact | null;
  defaultApplicationId?: string;
  onSubmit: (input: ContactInput) => void;
  onCancel: () => void;
}

const emptyContact = (applicationId: string | null = null): ContactInput => ({
  applicationId,
  name: '',
  email: '',
  linkedIn: '',
  company: '',
  source: 'manual',
  lastContactDate: null,
  messageNotes: '',
  nextAction: '',
});

export default function ContactForm({
  initial,
  defaultApplicationId,
  onSubmit,
  onCancel,
}: ContactFormProps) {
  const applications = useJobSearchStore((s) => s.applications);
  const [form, setForm] = useState<ContactInput>(
    emptyContact(defaultApplicationId ?? null),
  );

  useEffect(() => {
    if (initial) {
      setForm({
        applicationId: initial.applicationId,
        name: initial.name,
        email: initial.email,
        linkedIn: initial.linkedIn,
        company: initial.company ?? '',
        source: initial.source ?? 'manual',
        lastContactDate: initial.lastContactDate,
        messageNotes: initial.messageNotes,
        nextAction: initial.nextAction,
      });
    } else {
      setForm(emptyContact(defaultApplicationId ?? null));
    }
  }, [initial, defaultApplicationId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit(form);
  };

  const selectedApp = applications.find((a) => a.id === form.applicationId);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-gray-700">
          Linked application (optional)
        </span>
        <select
          value={form.applicationId ?? ''}
          onChange={(e) => {
            const applicationId = e.target.value || null;
            const app = applications.find((a) => a.id === applicationId);
            setForm((prev) => ({
              ...prev,
              applicationId,
              company: app?.company ?? prev.company,
            }));
          }}
          className={inputClass}
        >
          <option value="">No linked application yet</option>
          {applications.map((app) => (
            <option key={app.id} value={app.id}>
              {app.company} — {app.roleTitle}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Name *</span>
          <input
            required
            value={form.name}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, name: e.target.value }))
            }
            className={inputClass}
            placeholder="Jane Recruiter"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Company</span>
          <input
            value={form.company}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, company: e.target.value }))
            }
            className={inputClass}
            placeholder={selectedApp?.company ?? 'Acme Corp'}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Source</span>
          <select
            value={form.source}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, source: e.target.value }))
            }
            className={inputClass}
          >
            <option value="manual">Manual entry</option>
            <option value="email">Inbound email</option>
            <option value="linkedin">LinkedIn</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Last contact</span>
          <input
            type="date"
            value={form.lastContactDate ?? ''}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                lastContactDate: e.target.value || null,
              }))
            }
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Email</span>
          <input
            type="email"
            value={form.email}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, email: e.target.value }))
            }
            className={inputClass}
            placeholder="jane@company.com"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">LinkedIn</span>
          <input
            type="url"
            value={form.linkedIn}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, linkedIn: e.target.value }))
            }
            className={inputClass}
            placeholder="https://linkedin.com/in/..."
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Message notes</span>
        <textarea
          value={form.messageNotes}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, messageNotes: e.target.value }))
          }
          className={`${inputClass} min-h-[72px]`}
          placeholder="What was discussed..."
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Next action</span>
        <input
          value={form.nextAction}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, nextAction: e.target.value }))
          }
          className={inputClass}
          placeholder="Send follow-up email Thursday"
        />
      </label>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          {initial ? 'Save contact' : 'Add contact'}
        </button>
      </div>
    </form>
  );
}

export function ContactRow({
  contact,
  applications,
  onEdit,
  onDelete,
}: {
  contact: Contact;
  applications: Array<{ id: string; company: string; roleTitle: string }>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const linkedApp = contact.applicationId
    ? applications.find((a) => a.id === contact.applicationId)
    : null;
  const company =
    contact.company ||
    linkedApp?.company ||
    '';
  const subtitle = contactApplicationLabel({
    applicationId: contact.applicationId,
    company,
    roleTitle: linkedApp?.roleTitle,
    source: contact.source,
    linkedIn: contact.linkedIn,
  });

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium text-gray-900">{contact.name}</p>
        <p className="text-sm text-gray-600">{subtitle}</p>
        <div className="mt-2 text-sm text-gray-500 space-y-1">
          <p>Source: {contactSourceLabel(contact.source)}</p>
          {contact.email && <p>{contact.email}</p>}
          {contact.linkedIn && (
            <a
              href={contact.linkedIn}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:underline truncate block"
            >
              LinkedIn
            </a>
          )}
          {contact.lastContactDate && (
            <p>Last interaction: {formatDate(contact.lastContactDate)}</p>
          )}
          {linkedApp && (
            <p>
              Linked application: {linkedApp.company} — {linkedApp.roleTitle}
            </p>
          )}
          {!linkedApp && contact.applicationId == null && (
            <p className="text-gray-500">No linked application yet</p>
          )}
          {contact.messageNotes && (
            <p className="text-gray-600">{contact.messageNotes}</p>
          )}
          {isMeaningfulContactNextAction(contact.nextAction) && (
            <p className="text-amber-700 font-medium">
              Next action: {contact.nextAction}
            </p>
          )}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          type="button"
          onClick={onEdit}
          className="px-3 py-1.5 text-sm text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="px-3 py-1.5 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

const inputClass =
  'mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
