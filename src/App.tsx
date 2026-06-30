import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/AppShell';
import TodayPage from './pages/TodayPage';
import PipelinePage from './pages/PipelinePage';
import ApplicationsPage from './pages/ApplicationsPage';
import ContactsPage from './pages/ContactsPage';
import SettingsPage from './pages/SettingsPage';
import { useJobSearchStore } from './store/useJobSearchStore';

function AppBootstrap({ children }: { children: React.ReactNode }) {
  const initialize = useJobSearchStore((s) => s.initialize);
  const loading = useJobSearchStore((s) => s.loading);
  const error = useJobSearchStore((s) => s.error);
  const persistenceMode = useJobSearchStore((s) => s.persistenceMode);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-600">
        Loading your job search data…
      </div>
    );
  }

  return (
    <>
      {error && persistenceMode === 'api' && (
        <div
          className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-900 text-center"
          role="alert"
        >
          {error} Set <code className="font-mono">VITE_PERSISTENCE_MODE=demo</code>{' '}
          to use browser-only storage.
        </div>
      )}
      {children}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppBootstrap>
        <AppShell>
          <Routes>
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="/today" element={<TodayPage />} />
            <Route path="/pipeline" element={<PipelinePage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/dashboard" element={<Navigate to="/today" replace />} />
          </Routes>
        </AppShell>
      </AppBootstrap>
    </BrowserRouter>
  );
}
