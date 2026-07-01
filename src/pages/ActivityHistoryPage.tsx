import { useCallback, useEffect, useState } from 'react';
import { FiBarChart2, FiCalendar, FiTrendingUp } from 'react-icons/fi';
import {
  fetchActivityHistory,
  fetchProductivityInsights,
} from '../api/activityClient';
import {
  computeLocalActivityHistory,
  computeLocalProductivityInsights,
} from '../lib/activityMetrics';
import { isDemoMode } from '../api/persistence';
import { useJobSearchStore } from '../store/useJobSearchStore';
import { formatDate } from '../lib/dates';
import type { ActivityHistory, ProductivityInsights } from '../types/activity';
import { DEFAULT_JOB_SEARCH_GOALS } from '../types/activity';

export default function ActivityHistoryPage() {
  const demoMode = isDemoMode();
  const applications = useJobSearchStore((s) => s.applications);
  const [history, setHistory] = useState<ActivityHistory | null>(null);
  const [insights, setInsights] = useState<ProductivityInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'daily' | 'weekly' | 'monthly' | 'insights'>(
    'daily',
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (demoMode) {
        const stored = localStorage.getItem('job-search-goals');
        const goals = stored
          ? (JSON.parse(stored) as typeof DEFAULT_JOB_SEARCH_GOALS)
          : DEFAULT_JOB_SEARCH_GOALS;
        setHistory(computeLocalActivityHistory(applications, goals));
        setInsights(computeLocalProductivityInsights(applications));
      } else {
        const [historyData, insightsData] = await Promise.all([
          fetchActivityHistory(90),
          fetchProductivityInsights(),
        ]);
        setHistory(historyData);
        setInsights(insightsData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [applications, demoMode]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto">
        <p className="text-gray-500">Loading activity history…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (!history) return null;

  const tabs = [
    { id: 'daily' as const, label: 'Daily', icon: FiCalendar },
    { id: 'weekly' as const, label: 'Weekly', icon: FiBarChart2 },
    { id: 'monthly' as const, label: 'Monthly', icon: FiTrendingUp },
    { id: 'insights' as const, label: 'Insights', icon: FiTrendingUp },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900">Activity History</h2>
        <p className="mt-1 text-gray-600">
          Track your application consistency and goal completion over time.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg border transition ${
              tab === id
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'daily' && (
        <section className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Date</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">Applications</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">Goal</th>
                <th className="text-center px-4 py-3 font-medium text-gray-700">Met</th>
              </tr>
            </thead>
            <tbody>
              {[...history.daily].reverse().slice(0, 30).map((entry) => (
                <tr key={entry.date} className="border-b last:border-0">
                  <td className="px-4 py-2">{formatDate(entry.date)}</td>
                  <td className="px-4 py-2 text-right">{entry.count}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{entry.dailyGoal}</td>
                  <td className="px-4 py-2 text-center">
                    {entry.goalMet ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'weekly' && (
        <section className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Week</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">Applications</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">Goal</th>
                <th className="text-center px-4 py-3 font-medium text-gray-700">Met</th>
              </tr>
            </thead>
            <tbody>
              {[...history.weekly].reverse().map((entry) => (
                <tr key={entry.weekStart} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    {formatDate(entry.weekStart)} – {formatDate(entry.weekEnd)}
                  </td>
                  <td className="px-4 py-2 text-right">{entry.count}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{entry.weeklyGoal}</td>
                  <td className="px-4 py-2 text-center">
                    {entry.goalMet ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'monthly' && (
        <section className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Month</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">Applications</th>
                <th className="text-right px-4 py-3 font-medium text-gray-700">Goal</th>
                <th className="text-center px-4 py-3 font-medium text-gray-700">Met</th>
              </tr>
            </thead>
            <tbody>
              {[...history.monthly].reverse().map((entry) => (
                <tr key={entry.month} className="border-b last:border-0">
                  <td className="px-4 py-2">{entry.month}</td>
                  <td className="px-4 py-2 text-right">{entry.count}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{entry.monthlyGoal}</td>
                  <td className="px-4 py-2 text-center">
                    {entry.goalMet ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'insights' && insights && (
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InsightCard
            label="Best application day"
            value={insights.bestApplicationDayOfWeek}
          />
          <InsightCard
            label="Avg applications per week"
            value={String(insights.avgApplicationsPerWeek)}
          />
          <InsightCard
            label="Most productive month"
            value={insights.mostProductiveMonth ?? '—'}
          />
          <InsightCard
            label="Longest streak"
            value={`${insights.longestStreak} days`}
          />
          {insights.avgApplicationsBeforeFirstResponse !== null && (
            <InsightCard
              label="Avg days to first response"
              value={String(insights.avgApplicationsBeforeFirstResponse)}
            />
          )}
          {insights.recruiterResponseRate !== null && (
            <InsightCard
              label="Recruiter response rate"
              value={`${insights.recruiterResponseRate}%`}
            />
          )}
          {insights.interviewRate !== null && (
            <InsightCard
              label="Interview rate"
              value={`${insights.interviewRate}%`}
            />
          )}
          {insights.offerRate !== null && (
            <InsightCard
              label="Offer rate"
              value={`${insights.offerRate}%`}
            />
          )}
          {demoMode && (
            <p className="sm:col-span-2 text-sm text-gray-500">
              Correlation metrics (response rate, time to offer) require API mode
              with communications data.
            </p>
          )}
        </section>
      )}

      {history.streakHistory.length > 0 && tab !== 'insights' && (
        <section className="bg-white border rounded-lg p-5">
          <h3 className="font-medium text-gray-900 mb-3">Recent streak milestones</h3>
          <ul className="space-y-1 text-sm text-gray-600">
            {[...history.streakHistory]
              .filter((s) => s.streakDays >= 3)
              .slice(-10)
              .reverse()
              .map((s) => (
                <li key={s.date}>
                  {formatDate(s.date)} — {s.streakDays}-day streak
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function InsightCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border rounded-lg p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-xl font-semibold text-gray-900 mt-1">{value}</p>
    </div>
  );
}
