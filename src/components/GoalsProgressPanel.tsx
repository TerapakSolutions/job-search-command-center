import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiTarget, FiTrendingUp, FiZap } from 'react-icons/fi';
import {
  fetchActivityMetrics,
} from '../api/activityClient';
import {
  computeLocalActivityMetrics,
} from '../lib/activityMetrics';
import { isDemoMode } from '../api/persistence';
import { useJobSearchStore } from '../store/useJobSearchStore';
import type { ActivityMetrics } from '../types/activity';
import { DEFAULT_JOB_SEARCH_GOALS } from '../types/activity';

function ProgressBar({
  label,
  current,
  goal,
  percent,
  met,
}: {
  label: string;
  current: number;
  goal: number;
  percent: number;
  met: boolean;
}) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-700">{label}</span>
        <span className={met ? 'text-green-700 font-medium' : 'text-gray-600'}>
          {current}/{goal}
          {met && ' ✓'}
        </span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            met ? 'bg-green-500' : 'bg-blue-500'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export default function GoalsProgressPanel() {
  const demoMode = isDemoMode();
  const applications = useJobSearchStore((s) => s.applications);
  const [metrics, setMetrics] = useState<ActivityMetrics | null>(null);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (demoMode) {
      const stored = localStorage.getItem('job-search-goals');
      const goals = stored
        ? (JSON.parse(stored) as typeof DEFAULT_JOB_SEARCH_GOALS)
        : DEFAULT_JOB_SEARCH_GOALS;
      setMetrics(computeLocalActivityMetrics(applications, goals));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await fetchActivityMetrics();
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load progress');
    } finally {
      setLoading(false);
    }
  }, [applications, demoMode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!demoMode) return;
    const stored = localStorage.getItem('job-search-goals');
    const goals = stored
      ? (JSON.parse(stored) as typeof DEFAULT_JOB_SEARCH_GOALS)
      : DEFAULT_JOB_SEARCH_GOALS;
    setMetrics(computeLocalActivityMetrics(applications, goals));
  }, [applications, demoMode]);

  if (loading) {
    return (
      <section className="bg-white border rounded-lg p-5">
        <p className="text-sm text-gray-500">Loading goal progress…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-white border rounded-lg p-5">
        <p className="text-sm text-red-600">{error}</p>
      </section>
    );
  }

  if (!metrics) return null;

  const { progress, currentStreak, longestStreak } = metrics;

  return (
    <section className="bg-gradient-to-br from-blue-50 to-emerald-50 border border-blue-200 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-blue-900">
          <FiTarget />
          <h3 className="font-semibold">Job Search Goals</h3>
        </div>
        <Link
          to="/activity"
          className="text-sm text-blue-600 hover:underline"
        >
          View history
        </Link>
      </div>

      <div className="space-y-3">
        <ProgressBar
          label="Today"
          current={progress.daily.current}
          goal={progress.daily.goal}
          percent={progress.daily.percent}
          met={progress.daily.met}
        />
        <ProgressBar
          label="This week"
          current={progress.weekly.current}
          goal={progress.weekly.goal}
          percent={progress.weekly.percent}
          met={progress.weekly.met}
        />
        <ProgressBar
          label="This month"
          current={progress.monthly.current}
          goal={progress.monthly.goal}
          percent={progress.monthly.percent}
          met={progress.monthly.met}
        />
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-1.5 text-orange-700">
          <FiZap />
          <span>
            Current streak:{' '}
            <strong>{currentStreak} day{currentStreak === 1 ? '' : 's'}</strong>
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-purple-700">
          <FiTrendingUp />
          <span>
            Longest streak:{' '}
            <strong>{longestStreak} day{longestStreak === 1 ? '' : 's'}</strong>
          </span>
        </div>
      </div>
    </section>
  );
}
