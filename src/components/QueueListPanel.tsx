import { FiClock } from 'react-icons/fi';
import { useAppStore } from '../store/useAppStore';

export function QueueListPanel() {
  const queue = useAppStore((s) => s.queue);
  return (
    <div className="bg-white p-4 rounded shadow">
      <h3 className="text-lg font-semibold mb-2">Jobs in Queue</h3>
      <ul className="space-y-1">
        {queue.map((job) => (
          <li key={job.id} className="flex items-center">
            <FiClock className="text-orange-500 mr-2" />
            {job.title} @ {job.company}
          </li>
        ))}
      </ul>
    </div>
  );
}
