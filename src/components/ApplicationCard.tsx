import type { Application } from '../types/application';
import {
  PIPELINE_STATUS_LABELS,
  WORK_LOCATION_LABELS,
} from '../types/application';
import { formatDate } from '../lib/dates';

interface ApplicationCardProps {
  application: Application;
  compact?: boolean;
  onEdit?: (app: Application) => void;
  onMove?: (app: Application, status: Application['status']) => void;
}

export default function ApplicationCard({
  application,
  compact = false,
  onEdit,
}: ApplicationCardProps) {
  const salary =
    application.salaryMin || application.salaryMax
      ? [
          application.salaryMin?.toLocaleString(),
          application.salaryMax?.toLocaleString(),
        ]
          .filter(Boolean)
          .join(' – ')
      : null;

  return (
    <button
      type="button"
      onClick={() => onEdit?.(application)}
      className="w-full text-left bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow-md hover:border-blue-300 transition"
    >
      <p className="font-medium text-gray-900 truncate">{application.roleTitle}</p>
      <p className="text-sm text-gray-600 truncate">{application.company}</p>
      {!compact && (
        <div className="mt-2 space-y-1 text-xs text-gray-500">
          <p>
            {WORK_LOCATION_LABELS[application.workLocationType]}
            {application.location ? ` · ${application.location}` : ''}
          </p>
          {salary && <p>${salary}</p>}
          {application.dateApplied && (
            <p>Applied {formatDate(application.dateApplied)}</p>
          )}
          {application.interviewDate && (
            <p className="text-purple-600">
              Interview {formatDate(application.interviewDate)}
            </p>
          )}
        </div>
      )}
      {compact && (
        <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
          {PIPELINE_STATUS_LABELS[application.status]}
        </span>
      )}
    </button>
  );
}
