import { useState } from 'react';
import { linkEmailToApplication } from '../api/emailAutomationClient';

interface PickerApplication {
  id: string;
  company: string;
  roleTitle: string;
}

interface LinkedApplicationPickerProps {
  emailId: string;
  applications: PickerApplication[];
  linkedApplicationId: string | null;
  disabled?: boolean;
  onChanged: () => void;
}

// Lets the user tie an email to any of their applications when automatic
// matching misses it (for example, the recruiter renamed the role). Linking
// changes nothing on the application by itself.
export default function LinkedApplicationPicker({
  emailId,
  applications,
  linkedApplicationId,
  disabled = false,
  onChanged,
}: LinkedApplicationPickerProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = [...applications].sort(
    (a, b) =>
      a.company.localeCompare(b.company) || a.roleTitle.localeCompare(b.roleTitle),
  );

  const save = async (applicationId: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await linkEmailToApplication(emailId, applicationId);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link application');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-gray-700">
        Linked application
        <div className="mt-1 flex items-center gap-2">
          <select
            value={linkedApplicationId ?? ''}
            disabled={disabled || saving}
            onChange={(e) => void save(e.target.value || null)}
            className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs"
          >
            <option value="">Not linked</option>
            {sorted.map((app) => (
              <option key={app.id} value={app.id}>
                {app.company} — {app.roleTitle}
              </option>
            ))}
          </select>
        </div>
      </label>
      {linkedApplicationId && (
        <button
          type="button"
          disabled={disabled || saving}
          onClick={() => void save(null)}
          className="text-xs text-gray-600 underline hover:text-gray-900 disabled:opacity-60"
        >
          Unlink
        </button>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
