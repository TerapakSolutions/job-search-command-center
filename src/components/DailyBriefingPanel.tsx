import { useCallback, useEffect, useState } from 'react';
import {
  FiChevronDown,
  FiChevronUp,
  FiMail,
  FiRefreshCw,
  FiSun,
} from 'react-icons/fi';
import { formatDate } from '../lib/dates';
import {
  fetchBriefingHistory,
  fetchLatestBriefing,
  generateBriefing,
} from '../api/dailyBriefingsClient';
import type { DailyBriefing } from '../types/dailyBriefing';
import { isDemoMode } from '../api/persistence';

export default function DailyBriefingPanel() {
  const demoMode = isDemoMode();
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [history, setHistory] = useState<DailyBriefing[]>([]);
  const [loading, setLoading] = useState(!demoMode);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    if (demoMode) return;
    setLoading(true);
    setError(null);
    try {
      const [latest, past] = await Promise.all([
        fetchLatestBriefing(),
        fetchBriefingHistory(14),
      ]);
      setBriefing(latest);
      setHistory(past);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load briefing');
    } finally {
      setLoading(false);
    }
  }, [demoMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const result = await generateBriefing({ force: Boolean(briefing) });
      setBriefing(result);
      const past = await fetchBriefingHistory(14);
      setHistory(past);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  if (demoMode) {
    return (
      <section className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg p-5">
        <div className="flex items-center gap-2 text-indigo-900">
          <FiSun />
          <h3 className="font-semibold">AI Daily Executive Brief</h3>
        </div>
        <p className="mt-2 text-sm text-indigo-800">
          Daily briefings require API mode with Google sign-in. Switch to API persistence
          to receive personalized pipeline summaries and AI recommendations.
        </p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="bg-white border rounded-lg p-5 text-sm text-gray-500">
        Loading your daily executive brief…
      </section>
    );
  }

  return (
    <section className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-indigo-900">
            <FiSun />
            <h3 className="font-semibold">AI Daily Executive Brief</h3>
          </div>
          {briefing ? (
            <p className="mt-1 text-xs text-indigo-700">
              {formatDate(briefing.briefingDate)} ·{' '}
              {briefing.data.pipelineStats.active} active ·{' '}
              {briefing.data.pipelineStats.total} total
              {briefing.emailSentAt && (
                <span className="inline-flex items-center gap-1 ml-2">
                  <FiMail size={12} /> emailed
                </span>
              )}
            </p>
          ) : (
            <p className="mt-1 text-sm text-indigo-800">
              No briefing yet today. Generate one to see your pipeline summary and next
              actions.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={generating}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60"
        >
          <FiRefreshCw className={generating ? 'animate-spin' : ''} />
          {briefing ? 'Refresh brief' : 'Generate brief'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {briefing && (
        <>
          <div className="bg-white/80 rounded-lg p-4 text-sm text-gray-800 whitespace-pre-wrap">
            {briefing.aiSummary}
          </div>

          {briefing.data.recommendations.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-indigo-900 mb-2">
                Recommended actions
              </h4>
              <ul className="space-y-1 text-sm text-gray-700">
                {briefing.data.recommendations.map((rec) => (
                  <li key={rec} className="flex gap-2">
                    <span className="text-indigo-500">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <Stat label="New emails" value={briefing.data.newRecruiterEmails.length} />
            <Stat
              label="Submitted"
              value={briefing.data.applicationsSubmitted.length}
            />
            <Stat
              label="Interviews"
              value={briefing.data.upcomingInterviews.length}
            />
            <Stat label="Follow-ups" value={briefing.data.followUpNeeded.length} />
          </div>

          {briefing.data.changesSincePrevious.length > 0 && (
            <div className="text-xs text-indigo-800">
              <span className="font-medium">Since last brief: </span>
              {briefing.data.changesSincePrevious.join(' · ')}
            </div>
          )}
        </>
      )}

      {history.length > 1 && (
        <div>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1 text-sm text-indigo-700 hover:text-indigo-900"
          >
            {showHistory ? <FiChevronUp /> : <FiChevronDown />}
            Past briefings ({history.length})
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-1 text-sm text-gray-700">
              {history.map((item) => (
                <li
                  key={item.id}
                  className={`px-3 py-2 rounded border ${
                    item.id === briefing?.id
                      ? 'bg-white border-indigo-300'
                      : 'bg-white/60 border-transparent'
                  }`}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => setBriefing(item)}
                  >
                    <span className="font-medium">{formatDate(item.briefingDate)}</span>
                    <span className="text-gray-500 ml-2 truncate">
                      {item.aiSummary.slice(0, 80)}
                      {item.aiSummary.length > 80 ? '…' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white/70 rounded-lg py-2 px-1">
      <div className="text-lg font-semibold text-indigo-900">{value}</div>
      <div className="text-xs text-gray-600">{label}</div>
    </div>
  );
}
