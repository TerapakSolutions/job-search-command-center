import { useMemo, useState } from 'react';
import { FiPlus } from 'react-icons/fi';
import ApplicationCard from './ApplicationCard';
import ApplicationForm from './ApplicationForm';
import Modal from './Modal';
import { useJobSearchStore } from '../store/useJobSearchStore';
import {
  PIPELINE_STATUSES,
  PIPELINE_STATUS_LABELS,
  type Application,
  type PipelineStatus,
} from '../types/application';

const ACTIVE_COLUMNS: PipelineStatus[] = [
  'saved',
  'applied',
  'recruiter_screen',
  'interviewing',
  'final_round',
  'offer',
];

const CLOSED_COLUMNS: PipelineStatus[] = ['rejected', 'ghosted'];

export default function PipelineBoard() {
  const applications = useJobSearchStore((s) => s.applications);
  const addApplication = useJobSearchStore((s) => s.addApplication);
  const updateApplication = useJobSearchStore((s) => s.updateApplication);
  const moveApplication = useJobSearchStore((s) => s.moveApplication);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Application | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const grouped = useMemo(() => {
    const map = Object.fromEntries(
      PIPELINE_STATUSES.map((s) => [s, [] as Application[]]),
    ) as Record<PipelineStatus, Application[]>;
    for (const app of applications) {
      map[app.status]?.push(app);
    }
    return map;
  }, [applications]);

  const columns = showClosed
    ? [...ACTIVE_COLUMNS, ...CLOSED_COLUMNS]
    : ACTIVE_COLUMNS;

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (app: Application) => {
    setEditing(app);
    setModalOpen(true);
  };

  const handleSubmit = (input: Parameters<typeof addApplication>[0]) => {
    if (editing) {
      updateApplication(editing.id, input);
    } else {
      addApplication(input);
    }
    setModalOpen(false);
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          {applications.length} application{applications.length !== 1 ? 's' : ''} tracked
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
              className="rounded border-gray-300"
            />
            Show rejected & archived
          </label>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            <FiPlus className="mr-2" />
            Add application
          </button>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((status) => (
          <div
            key={status}
            className="flex-shrink-0 w-64 bg-gray-50 rounded-xl border border-gray-200"
          >
            <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">
                {PIPELINE_STATUS_LABELS[status]}
              </h3>
              <span className="text-xs font-medium text-gray-500 bg-white px-2 py-0.5 rounded-full">
                {grouped[status].length}
              </span>
            </div>
            <div className="p-2 space-y-2 min-h-[120px] max-h-[calc(100vh-280px)] overflow-y-auto">
              {grouped[status].map((app) => (
                <div key={app.id} className="space-y-1">
                  <ApplicationCard
                    application={app}
                    compact
                    onEdit={openEdit}
                  />
                  <select
                    value={app.status}
                    onChange={(e) =>
                      moveApplication(app.id, e.target.value as PipelineStatus)
                    }
                    className="w-full text-xs px-2 py-1 border border-gray-200 rounded bg-white text-gray-600"
                    aria-label={`Move ${app.company} to stage`}
                  >
                    {PIPELINE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        → {PIPELINE_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {grouped[status].length === 0 && (
                <p className="text-xs text-gray-400 text-center py-6">Empty</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal
        title={editing ? 'Edit application' : 'New application'}
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
      >
        <ApplicationForm
          initial={editing}
          onSubmit={handleSubmit}
          onCancel={() => {
            setModalOpen(false);
            setEditing(null);
          }}
        />
      </Modal>
    </div>
  );
}
