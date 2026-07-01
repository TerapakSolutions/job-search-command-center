import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  FiCalendar,
  FiColumns,
  FiBriefcase,
  FiMessageCircle,
  FiSettings,
  FiLogOut,
} from 'react-icons/fi';
import { isDemoMode } from '../api/persistence';
import { computeReminders } from '../lib/reminders';
import { useAuthStore } from '../store/useAuthStore';
import { useJobSearchStore } from '../store/useJobSearchStore';

interface AppShellProps {
  children: ReactNode;
}

const navItems = [
  { to: '/today', label: 'Today', icon: FiCalendar },
  { to: '/pipeline', label: 'Pipeline', icon: FiColumns },
  { to: '/applications', label: 'Applications', icon: FiBriefcase },
  { to: '/contacts', label: 'Contacts', icon: FiMessageCircle },
  { to: '/settings', label: 'Settings', icon: FiSettings },
];

const pageTitles: Record<string, string> = {
  '/today': 'Daily Actions',
  '/pipeline': 'Pipeline Board',
  '/applications': 'Applications',
  '/contacts': 'Communications',
  '/settings': 'Settings',
};

export default function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const applications = useJobSearchStore((s) => s.applications);
  const contacts = useJobSearchStore((s) => s.contacts);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const demoMode = isDemoMode();
  const reminderCount = useMemo(
    () => computeReminders(applications, contacts).length,
    [applications, contacts],
  );

  const title = pageTitles[location.pathname] ?? 'Job Search Command Center';

  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-60 bg-gray-900 text-white flex flex-col shrink-0">
        <div className="px-6 py-5 flex-shrink-0 border-b border-gray-800">
          <span className="text-lg font-bold tracking-wide leading-tight block">
            Job Search
          </span>
          <span className="text-xs text-gray-400">Command Center</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center px-4 py-2.5 rounded-lg text-sm transition ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <Icon className="mr-3 shrink-0" size={18} />
              {label}
              {to === '/today' && reminderCount > 0 && (
                <span className="ml-auto text-xs bg-red-500 text-white px-1.5 py-0.5 rounded-full">
                  {reminderCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-gray-800">
          {user && !demoMode ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt=""
                    className="h-9 w-9 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-gray-700 flex items-center justify-center text-sm font-medium">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate">{user.name}</div>
                  <div className="text-xs text-gray-400 truncate">{user.email}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-gray-800 hover:text-white"
              >
                <FiLogOut size={16} />
                Sign out
              </button>
            </div>
          ) : (
            <div className="text-xs text-gray-500">
              {demoMode ? 'Demo mode — data stored in your browser' : 'Signed in'}
            </div>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b px-6 flex items-center shadow-sm shrink-0">
          <h1 className="text-xl font-semibold text-gray-800">{title}</h1>
        </header>
        <main className="p-6 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
