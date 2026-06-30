import { useAppStore } from '../store/useAppStore';
import ActivateSearchButton from './ActivateSearchButton';

export default function SearchStatusBanner() {
  const status = useAppStore((s) => s.status);
  const setStatus = useAppStore((s) => s.setStatus);

  if (status !== 'active') {
    return <ActivateSearchButton />;
  }
  return (
    <div className="bg-yellow-100 border-l-4 border-yellow-500 p-4 mb-6">
      🔍 Job Search Active — our AI engine is busy!
      <button
        type="button"
        className="ml-4 px-2 py-1 bg-white border rounded"
        onClick={() => setStatus('paused')}
      >
        Pause Search
      </button>
    </div>
  );
}
