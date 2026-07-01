import { useCallback, useEffect, useState } from 'react';
import {
  fetchJobSearchGoals,
  updateJobSearchGoals,
} from '../api/activityClient';
import { isDemoMode } from '../api/persistence';
import type { JobSearchGoals } from '../types/activity';
import { DEFAULT_JOB_SEARCH_GOALS } from '../types/activity';

const DEMO_GOALS_KEY = 'job-search-goals';

function loadDemoGoals(): JobSearchGoals {
  const stored = localStorage.getItem(DEMO_GOALS_KEY);
  if (stored) {
    return JSON.parse(stored) as JobSearchGoals;
  }
  return { ...DEFAULT_JOB_SEARCH_GOALS };
}

function saveDemoGoals(goals: JobSearchGoals): void {
  localStorage.setItem(DEMO_GOALS_KEY, JSON.stringify(goals));
}

export default function JobSearchGoalsSettings() {
  const demoMode = isDemoMode();
  const [goals, setGoals] = useState<JobSearchGoals>(DEFAULT_JOB_SEARCH_GOALS);
  const [loading, setLoading] = useState(!demoMode);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (demoMode) {
      setGoals(loadDemoGoals());
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await fetchJobSearchGoals();
      setGoals(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load goals');
    } finally {
      setLoading(false);
    }
  }, [demoMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      if (demoMode) {
        saveDemoGoals(goals);
        setMessage('Goals saved locally.');
      } else {
        const updated = await updateJobSearchGoals({
          dailyGoal: goals.dailyGoal,
          weeklyGoal: goals.weeklyGoal,
          monthlyGoal: goals.monthlyGoal,
        });
        setGoals(updated);
        setMessage('Goals saved.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save goals');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="bg-white border rounded-lg p-6">
        <p className="text-sm text-gray-500">Loading goals…</p>
      </section>
    );
  }

  return (
    <section className="bg-white border rounded-lg p-6 space-y-4">
      <div>
        <h3 className="font-medium text-gray-900">Job search goals</h3>
        <p className="text-sm text-gray-500 mt-1">
          Set daily, weekly, and monthly application targets to stay consistent.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Daily</span>
          <input
            type="number"
            min={1}
            value={goals.dailyGoal}
            onChange={(e) =>
              setGoals({ ...goals, dailyGoal: Number(e.target.value) })
            }
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Weekly</span>
          <input
            type="number"
            min={1}
            value={goals.weeklyGoal}
            onChange={(e) =>
              setGoals({ ...goals, weeklyGoal: Number(e.target.value) })
            }
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Monthly</span>
          <input
            type="number"
            min={1}
            value={goals.monthlyGoal}
            onChange={(e) =>
              setGoals({ ...goals, monthlyGoal: Number(e.target.value) })
            }
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save goals'}
        </button>
        {message && (
          <p className="text-sm text-green-700" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
