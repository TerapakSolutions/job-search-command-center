import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/AppShell';
import TodayPage from './pages/TodayPage';
import PipelinePage from './pages/PipelinePage';
import ApplicationsPage from './pages/ApplicationsPage';
import ContactsPage from './pages/ContactsPage';
import InboundEmailsPage from './pages/InboundEmailsPage';
import SettingsPage from './pages/SettingsPage';
import ActivityHistoryPage from './pages/ActivityHistoryPage';
import LoginPage from './pages/LoginPage';
import { isDemoMode } from './api/persistence';
import { SESSION_EXPIRED_EVENT } from './api/http';
import { useAuthStore } from './store/useAuthStore';
import { useJobSearchStore } from './store/useJobSearchStore';

/**
 * Any 401 from the API means the session is gone. Drop the stale user so
 * AuthGate renders the login screen instead of leaving a dead shell on screen.
 */
function useSessionExpiryHandler() {
  const handleSessionExpired = useAuthStore((s) => s.handleSessionExpired);

  useEffect(() => {
    const onExpired = () => handleSessionExpired();
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [handleSessionExpired]);
}

function AppBootstrap({ children }: { children: React.ReactNode }) {
  const initialize = useJobSearchStore((s) => s.initialize);
  const loading = useJobSearchStore((s) => s.loading);
  const error = useJobSearchStore((s) => s.error);
  const apiUnreachable = useJobSearchStore((s) => s.apiUnreachable);
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
          {error}
          {apiUnreachable && (
            <>
              {' '}
              Set <code className="font-mono">VITE_PERSISTENCE_MODE=demo</code> to use
              browser-only storage.
            </>
          )}
        </div>
      )}
      {children}
    </>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const demoMode = isDemoMode();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const checked = useAuthStore((s) => s.checked);
  const checkAuth = useAuthStore((s) => s.checkAuth);

  useEffect(() => {
    if (!demoMode) {
      void checkAuth();
    }
  }, [checkAuth, demoMode]);

  if (demoMode) {
    return <>{children}</>;
  }

  if (!checked || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-600">
        Checking authentication…
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return <>{children}</>;
}

export default function App() {
  useSessionExpiryHandler();

  return (
    <BrowserRouter>
      <AuthGate>
        <AppBootstrap>
          <AppShell>
            <Routes>
              <Route path="/" element={<Navigate to="/today" replace />} />
              <Route path="/today" element={<TodayPage />} />
              <Route path="/pipeline" element={<PipelinePage />} />
              <Route path="/applications" element={<ApplicationsPage />} />
              <Route path="/contacts" element={<ContactsPage />} />
              <Route path="/inbound-emails" element={<InboundEmailsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/activity" element={<ActivityHistoryPage />} />
              <Route path="/login" element={<Navigate to="/today" replace />} />
              <Route path="/dashboard" element={<Navigate to="/today" replace />} />
            </Routes>
          </AppShell>
        </AppBootstrap>
      </AuthGate>
    </BrowserRouter>
  );
}
