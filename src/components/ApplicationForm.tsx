import { useEffect, useState } from 'react';
import type {
  Application,
  ApplicationInput,
  EmploymentType,
  PayPeriod,
  PipelineStatus,
} from '../types/application';
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  PAY_PERIODS,
  PAY_PERIOD_LABELS,
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
  payPeriod: null,
  employmentType: null,
  agency: null,
  submittedDate: null,
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
        payPeriod: initial.payPeriod ?? null,
        employmentType: initial.employmentType ?? null,
        agency: initial.agency ?? null,
        submittedDate: initial.submittedDate ?? null,
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
        <Field label="Pay min">
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
            step="any"
            placeholder="120000 or 65"
          />
        </Field>
        <Field label="Pay max">
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
            step="any"
            placeholder="160000 or 70"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Pay period">
          <select
            value={form.payPeriod ?? 'year'}
            onChange={(e) => updateField('payPeriod', e.target.value as PayPeriod)}
            className={inputClass}
          >
            {PAY_PERIODS.map((period) => (
              <option key={period} value={period}>
                {PAY_PERIOD_LABELS[period]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Engagement type">
          <select
            value={form.employmentType ?? ''}
            onChange={(e) =>
              updateField(
                'employmentType',
                e.target.value ? (e.target.value as EmploymentType) : null,
              )
            }
            className={inputClass}
          >
            <option value="">Not set</option>
            {EMPLOYMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {EMPLOYMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Staffing agency">
          <input
            value={form.agency ?? ''}
            onChange={(e) => updateField('agency', e.target.value || null)}
            className={inputClass}
            placeholder="Agency that submitted you (company is the client)"
          />
        </Field>
        <Field label="Date submitted">
          <input
            type="date"
            value={form.submittedDate ?? ''}
            onChange={(e) => updateField('submittedDate', e.target.value || null)}
            className={inputClass}
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
