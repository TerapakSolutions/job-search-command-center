import { useMemo, useState } from 'react';
import { FiPlus, FiSearch, FiTrash2 } from 'react-icons/fi';
import ApplicationCard from '../components/ApplicationCard';
import ApplicationForm from '../components/ApplicationForm';
import Modal from '../components/Modal';
import { useJobSearchStore } from '../store/useJobSearchStore';
import type { Application } from '../types/application';
import { PIPELINE_STATUS_LABELS } from '../types/application';

export default function ApplicationsPage() {
  const applications = useJobSearchStore((s) => s.applications);
  const addApplication = useJobSearchStore((s) => s.addApplication);
  const updateApplication = useJobSearchStore((s) => s.updateApplication);
  const deleteApplication = useJobSearchStore((s) => s.deleteApplication);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Application | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return applications.filter((app) => {
      const matchesSearch =
        !q ||
        app.company.toLowerCase().includes(q) ||
        app.roleTitle.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === 'all' || app.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [applications, search, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (app: Application) => {
    setEditing(app);
    setModalOpen(true);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Applications</h2>
          <p className="mt-1 text-gray-600">
            Add, edit, and search all tracked roles.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          <FiPlus className="mr-2" />
          New application
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company or role..."
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="all">All statuses</option>
          {Object.entries(PIPELINE_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-gray-500 py-12 bg-white border rounded-lg">
          {applications.length === 0
            ? 'No applications yet. Add your first role to get started.'
            : 'No applications match your filters.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((app) => (
            <div key={app.id} className="relative group">
              <ApplicationCard application={app} onEdit={openEdit} />
              <div className="mt-2 flex items-center justify-between text-xs text-gray-500 px-1">
                <span>{PIPELINE_STATUS_LABELS[app.status]}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete ${app.company}?`)) {
                      deleteApplication(app.id);
                    }
                  }}
                  className="inline-flex items-center text-red-600 hover:text-red-700 opacity-0 group-hover:opacity-100 transition"
                >
                  <FiTrash2 className="mr-1" size={12} />
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
          onSubmit={(input) => {
            if (editing) {
              updateApplication(editing.id, input);
            } else {
              addApplication(input);
            }
            setModalOpen(false);
            setEditing(null);
          }}
          onCancel={() => {
            setModalOpen(false);
            setEditing(null);
          }}
        />
        {editing && (
          <div className="mt-4 pt-4 border-t">
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Delete ${editing.company}?`)) {
                  deleteApplication(editing.id);
                  setModalOpen(false);
                  setEditing(null);
                }
              }}
              className="text-sm text-red-600 hover:text-red-700"
            >
              Delete this application
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
