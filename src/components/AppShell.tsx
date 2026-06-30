import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { FiHome, FiSettings, FiMenu } from 'react-icons/fi';

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-screen">
      <aside className="w-60 bg-gray-900 text-white flex flex-col">
        <div className="px-6 py-4 flex-shrink-0">
          <span className="text-lg font-bold tracking-wide">SmartApp</span>
        </div>

        <nav className="flex-1 px-3 space-y-2">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `flex items-center px-4 py-2 rounded-lg transition ${
                isActive ? 'bg-gray-700' : 'hover:bg-gray-800'
              }`
            }
          >
            <FiHome className="mr-3" />
            Dashboard
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center px-4 py-2 rounded-lg transition ${
                isActive ? 'bg-gray-700' : 'hover:bg-gray-800'
              }`
            }
          >
            <FiSettings className="mr-3" />
            Settings
          </NavLink>
        </nav>

        <div className="px-4 py-3 md:hidden">
          <FiMenu size={24} className="text-gray-400 hover:text-white cursor-pointer" />
        </div>
      </aside>

      <div className="flex-1 flex flex-col bg-white">
        <header className="h-16 border-b px-6 flex items-center shadow-sm">
          <h1 className="text-xl font-semibold text-gray-800">My Project Dashboard</h1>
        </header>
        <main className="p-8 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
