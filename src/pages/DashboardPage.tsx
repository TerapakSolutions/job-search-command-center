import type { ReactNode } from 'react';
import { FiPauseCircle, FiCheckCircle, FiClock, FiEye } from 'react-icons/fi';

interface DashboardStat {
  label: string;
  value: number;
  icon: ReactNode;
}

export default function DashboardPage() {
  const stats: DashboardStat[] = [
    {
      label: 'Completed Applications',
      value: 382,
      icon: <FiCheckCircle size={24} className="text-green-500" />,
    },
    {
      label: 'Jobs in Queue',
      value: 99,
      icon: <FiClock size={24} className="text-yellow-500" />,
    },
    {
      label: 'Preview Applications',
      value: 0,
      icon: <FiEye size={24} className="text-blue-500" />,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-8 py-8">
      <h2 className="text-2xl font-semibold text-gray-800">Dashboard</h2>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="md:col-span-2 bg-white rounded-lg shadow p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-700">Job Search Active</h3>
            <p className="mt-1 text-sm text-gray-600">
              Our AI engine is busy searching the web and applying for roles that match your job
              preferences. Stay tuned—opportunities are heading your way!
            </p>
          </div>
          <button
            type="button"
            className="mt-4 inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
          >
            <FiPauseCircle className="mr-2" /> Pause Search
          </button>
        </div>

        {stats.map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-lg shadow p-4 flex items-center justify-between"
          >
            <div>
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className="mt-1 text-2xl font-bold text-gray-800">{s.value}</p>
            </div>
            {s.icon}
          </div>
        ))}
      </div>
    </div>
  );
}
