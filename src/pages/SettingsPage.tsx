import { useRef, useState } from 'react';
import { useJobSearchStore } from '../store/useJobSearchStore';
import AiAssistPlaceholder from '../components/AiAssistPlaceholder';

export default function SettingsPage() {
  const exportData = useJobSearchStore((s) => s.exportData);
  const importData = useJobSearchStore((s) => s.importData);
  const clearAll = useJobSearchStore((s) => s.clearAll);
  const applications = useJobSearchStore((s) => s.applications);
  const contacts = useJobSearchStore((s) => s.contacts);
  const persistenceMode = useJobSearchStore((s) => s.persistenceMode);
  const error = useJobSearchStore((s) => s.error);

  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleExport = () => {
    const blob = new Blob([exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `job-search-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage('Backup downloaded.');
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importData(reader.result as string);
        setMessage('Data imported successfully.');
      } catch {
        setMessage('Import failed — invalid JSON file.');
      }
    };
    reader.readAsText(file);
  };

  const persistenceLabel =
    persistenceMode === 'demo'
      ? 'Demo mode — data stored in browser localStorage'
      : 'API mode — data stored in SQLite via the backend';

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900">Settings</h2>
        <p className="mt-1 text-gray-600">
          Export, import, or reset your job search data.
        </p>
      </div>

      <section className="bg-white border rounded-lg p-6 space-y-4">
        <h3 className="font-medium text-gray-900">Persistence</h3>
        <p className="text-sm text-gray-600">{persistenceLabel}</p>
        {persistenceMode === 'demo' && (
          <p className="text-sm text-gray-500">
            No backend required. Data lives under the localStorage key{' '}
            <code className="font-mono text-xs">job-search-command-center</code>.
          </p>
        )}
        {persistenceMode === 'api' && (
          <p className="text-sm text-gray-500">
            Run <code className="font-mono text-xs">pnpm dev:all</code> locally, or
            deploy to Fly.io for a shared SQLite database at{' '}
            <code className="font-mono text-xs">/data/jobsearch.sqlite</code>.
          </p>
        )}
        {error && (
          <p className="text-sm text-amber-700" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="bg-white border rounded-lg p-6 space-y-4">
        <h3 className="font-medium text-gray-900">Data backup</h3>
        <p className="text-sm text-gray-500">
          {applications.length} applications · {contacts.length} contacts
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleExport}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Export backup
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            Import backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImport(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  'Delete all applications and contacts? This cannot be undone.',
                )
              ) {
                clearAll();
                setMessage('All data cleared.');
              }
            }}
            className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100"
          >
            Clear all data
          </button>
        </div>
        {message && (
          <p className="text-sm text-green-700" role="status">
            {message}
          </p>
        )}
      </section>

      <AiAssistPlaceholder />
    </div>
  );
}
