import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { fetchJobSearchGoals } from '../api/activityClient';
import { useJobSearchStore } from '../store/useJobSearchStore';
import { computeLocalActivityMetrics, firstPeriodGoals } from '../lib/activityMetrics';
import { DEFAULT_JOB_SEARCH_GOALS, type JobSearchGoals } from '../types/activity';
import ContactLine from './ContactLine';

const TERMINAL_STATUSES = new Set(['rejected', 'ghosted']);

function formatWrittenAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function DailyBriefingPanel() {
  const demoMode = isDemoMode();
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [history, setHistory] = useState<DailyBriefing[]>([]);
  const [loading, setLoading] = useState(!demoMode);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // API mode keeps goals on the server (Settings → Job search goals);
  // localStorage only holds demo-mode goals.
  const [savedGoals, setSavedGoals] = useState<JobSearchGoals | null>(null);
  const autoRefreshed = useRef(false);

  // Goal progress + pipeline stats are computed LIVE from current applications
  // so they never go stale behind the AI-narrative snapshot (which is
  // point-in-time by design). Mirrors GoalsProgressPanel's source.
  const applications = useJobSearchStore((s) => s.applications);
  const liveMetrics = useMemo(() => {
    let goals: JobSearchGoals = savedGoals ?? DEFAULT_JOB_SEARCH_GOALS;
    if (!savedGoals) {
      try {
        const stored = localStorage.getItem('job-search-goals');
        if (stored) goals = JSON.parse(stored) as JobSearchGoals;
      } catch {
        goals = DEFAULT_JOB_SEARCH_GOALS;
      }
    }
    const scaled = firstPeriodGoals(goals, savedGoals?.goalsSetAt);
    return computeLocalActivityMetrics(applications, scaled.goals);
  }, [applications, savedGoals]);
  // Placeholder goals the user never chose: show counts, not targets.
  const goalsUnset = savedGoals?.goalsSetAt === null;
  const livePipeline = useMemo(
    () => ({
      total: applications.length,
      active: applications.filter((a) => !TERMINAL_STATUSES.has(a.status)).length,
    }),
    [applications],
  );

  const load = useCallback(async () => {
    if (demoMode) return;
    setLoading(true);
    setError(null);
    try {
      const [latest, past, goals] = await Promise.all([
        fetchLatestBriefing(),
        fetchBriefingHistory(14),
        fetchJobSearchGoals().catch(() => null),
      ]);
      setBriefing(latest);
      setHistory(past);
      setSavedGoals(goals);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load briefing');
    } finally {
      setLoading(false);
    }
  }, [demoMode]);

  useEffect(() => {
    void load();
  }, [load]);

  // The brief text is a point-in-time snapshot. If any application changed
  // after it was written, rewrite it once so it doesn't contradict the live
  // numbers beside it.
  useEffect(() => {
    if (demoMode || loading || generating || !briefing || autoRefreshed.current) {
      return;
    }
    const writtenAt = new Date(briefing.updatedAt).getTime();
    const goalsChangedSince =
      savedGoals?.updatedAt !== undefined &&
      new Date(savedGoals.updatedAt).getTime() > writtenAt;
    const changedSince =
      goalsChangedSince ||
      applications.some((app) => new Date(app.updatedAt).getTime() > writtenAt);
    if (!changedSince) return;
    autoRefreshed.current = true;
    void handleGenerate();
    // handleGenerate is recreated each render; the ref guards a single run.
  }, [applications, briefing, demoMode, generating, loading, savedGoals]);

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
              {generating
                ? 'Updating…'
                : `Written ${formatWrittenAt(briefing.updatedAt)}${
                    briefing.data.summarySource === 'rules' ||
                    briefing.data.summarySource === 'paused'
                      ? ' · rules only'
                      : ''
                  }`}{' '}
              · {livePipeline.active} active ·{' '}
              {livePipeline.total} total
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
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-900">
              <p className="font-medium mb-1">Goal progress</p>
              {goalsUnset ? (
                <>
                  <p>
                    Today: {liveMetrics.applicationsToday} · Week:{' '}
                    {liveMetrics.applicationsThisWeek} · Streak: {liveMetrics.currentStreak} days
                  </p>
                  <p className="mt-1 text-emerald-800">
                    Set your goals in Settings to track your pace.
                  </p>
                </>
              ) : (
              <p>
                Today: {liveMetrics.applicationsToday}/
                {liveMetrics.goals.dailyGoal} · Week:{' '}
                {liveMetrics.applicationsThisWeek}/
                {liveMetrics.goals.weeklyGoal} · Streak:{' '}
                {liveMetrics.currentStreak} days
              </p>
              )}
              {!goalsUnset && !liveMetrics.progress.daily.met && (
                <p className="mt-1 text-emerald-800">
                  {liveMetrics.applicationsToday === 0
                    ? `No applications logged today — your goal is ${liveMetrics.goals.dailyGoal}.`
                    : `${liveMetrics.applicationsToday} of ${liveMetrics.goals.dailyGoal} today — keep going.`}
                </p>
              )}
            </div>

          {briefing.data.summarySource === 'paused' && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              AI features are paused until the monthly limit resets. This brief was written without
              AI. Questions? <ContactLine />.
            </p>
          )}

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
