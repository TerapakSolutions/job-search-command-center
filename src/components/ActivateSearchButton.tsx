import { useAppStore } from '../store/useAppStore';

export default function ActivateSearchButton() {
  const setStatus = useAppStore((s) => s.setStatus);

  return (
    <button
      type="button"
      onClick={() => setStatus('active')}
      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
    >
      Activate Search
    </button>
  );
}
