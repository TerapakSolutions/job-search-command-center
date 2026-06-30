import { useEffect, useState } from 'react';
import type { Application, ApplicationInput, PipelineStatus } from '../types/application';
import {
  PIPELINE_STATUSES,
  PIPELINE_STATUS_LABELS,
  WORK_LOCATION_TYPES,
  WORK_LOCATION_LABELS,
} from '../types/application';

interface ApplicationFormProps {
  initial?: Application | null;
  onSubmit: (input: ApplicationInput) => void;
  onCancel: () => void;
}

const emptyForm: ApplicationInput = {
  company: '',
  roleTitle: '',
  jobUrl: '',
  workLocationType: 'remote',
  location: '',
  salaryMin: null,
  salaryMax: null,
  dateApplied: null,
  status: 'saved',
  notes: '',
  interviewDate: null,
};

export default function ApplicationForm({
  initial,
  onSubmit,
  onCancel,
}: ApplicationFormProps) {
  const [form, setForm] = useState<ApplicationInput>(emptyForm);

  useEffect(() => {
    if (initial) {
      setForm({
        company: initial.company,
        roleTitle: initial.roleTitle,
        jobUrl: initial.jobUrl,
        workLocationType: initial.workLocationType,
        location: initial.location,
        salaryMin: initial.salaryMin,
        salaryMax: initial.salaryMax,
        dateApplied: initial.dateApplied,
        status: initial.status,
        notes: initial.notes,
        interviewDate: initial.interviewDate,
      });
    } else {
      setForm(emptyForm);
    }
  }, [initial]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company.trim() || !form.roleTitle.trim()) return;
    onSubmit(form);
  };

  const updateField = <K extends keyof ApplicationInput>(
    key: K,
    value: ApplicationInput[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Company *">
          <input
            required
            value={form.company}
            onChange={(e) => updateField('company', e.target.value)}
            className={inputClass}
            placeholder="Acme Corp"
          />
        </Field>
        <Field label="Role title *">
          <input
            required
            value={form.roleTitle}
            onChange={(e) => updateField('roleTitle', e.target.value)}
            className={inputClass}
            placeholder="Senior Engineer"
          />
        </Field>
      </div>

      <Field label="Job URL">
        <input
          type="url"
          value={form.jobUrl}
          onChange={(e) => updateField('jobUrl', e.target.value)}
          className={inputClass}
          placeholder="https://..."
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Work location">
          <select
            value={form.workLocationType}
            onChange={(e) =>
              updateField(
                'workLocationType',
                e.target.value as ApplicationInput['workLocationType'],
              )
            }
            className={inputClass}
          >
            {WORK_LOCATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {WORK_LOCATION_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Location">
          <input
            value={form.location}
            onChange={(e) => updateField('location', e.target.value)}
            className={inputClass}
            placeholder="San Francisco, CA"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Salary min">
          <input
            type="number"
            value={form.salaryMin ?? ''}
            onChange={(e) =>
              updateField(
                'salaryMin',
                e.target.value ? Number(e.target.value) : null,
              )
            }
            className={inputClass}
            placeholder="120000"
          />
        </Field>
        <Field label="Salary max">
          <input
            type="number"
            value={form.salaryMax ?? ''}
            onChange={(e) =>
              updateField(
                'salaryMax',
                e.target.value ? Number(e.target.value) : null,
              )
            }
            className={inputClass}
            placeholder="160000"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Date applied">
          <input
            type="date"
            value={form.dateApplied ?? ''}
            onChange={(e) =>
              updateField('dateApplied', e.target.value || null)
            }
            className={inputClass}
          />
        </Field>
        <Field label="Interview date">
          <input
            type="date"
            value={form.interviewDate ?? ''}
            onChange={(e) =>
              updateField('interviewDate', e.target.value || null)
            }
            className={inputClass}
          />
        </Field>
        <Field label="Pipeline status">
          <select
            value={form.status}
            onChange={(e) =>
              updateField('status', e.target.value as PipelineStatus)
            }
            className={inputClass}
          >
            {PIPELINE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PIPELINE_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Notes">
        <textarea
          value={form.notes}
          onChange={(e) => updateField('notes', e.target.value)}
          className={`${inputClass} min-h-[80px]`}
          placeholder="Why this role, referral info, etc."
        />
      </Field>

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
          {initial ? 'Save changes' : 'Add application'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
