import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiAlertCircle, FiCalendar, FiClock, FiRefreshCw } from 'react-icons/fi';
import { computeReminders } from '../lib/reminders';
import { computeGoalReminders } from '../lib/goalReminders';
import { computeLocalActivityMetrics } from '../lib/activityMetrics';
import { fetchActivityMetrics } from '../api/activityClient';
import { isDemoMode } from '../api/persistence';
import { useJobSearchStore } from '../store/useJobSearchStore';
import { REMINDER_TYPE_LABELS, type Reminder } from '../types/reminder';
import { DEFAULT_JOB_SEARCH_GOALS } from '../types/activity';
import type { ActivityMetrics } from '../types/activity';
import { formatDate } from '../lib/dates';
import {
  contactApplicationLabel,
  isMeaningfulContactNextAction,
} from '../lib/contactDisplay';
import DailyBriefingPanel from '../components/DailyBriefingPanel';
import AutomationDashboardPanel from '../components/AutomationDashboardPanel';
import GoalsProgressPanel from '../components/GoalsProgressPanel';

const priorityStyles = {
  high: 'border-red-200 bg-red-50',
  medium: 'border-amber-200 bg-amber-50',
  low: 'border-gray-200 bg-gray-50',
};

export default function TodayPage() {
  const applications = useJobSearchStore((s) => s.applications);
  const contacts = useJobSearchStore((s) => s.contacts);
  const refreshData = useJobSearchStore((s) => s.refreshData);
  const demoMode = isDemoMode();
  const [activityMetrics, setActivityMetrics] = useState<ActivityMetrics | null>(
    null,
  );
  const [metricsLoading, setMetricsLoading] = useState(false);

  const loadMetrics = useCallback(
    async (options?: { refreshStore?: boolean }) => {
      setMetricsLoading(true);
      if (demoMode) {
        setMetricsLoading(false);
        return;
      }
      try {
        if (options?.refreshStore) {
          await refreshData();
        }
        const data = await fetchActivityMetrics();
        setActivityMetrics(data);
      } catch {
        setActivityMetrics(null);
      } finally {
        setMetricsLoading(false);
      }
    },
    [demoMode, refreshData],
  );

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  useEffect(() => {
    if (!demoMode) return;
    const stored = localStorage.getItem('job-search-goals');
    const goals = stored
      ? (JSON.parse(stored) as typeof DEFAULT_JOB_SEARCH_GOALS)
      : DEFAULT_JOB_SEARCH_GOALS;
    setActivityMetrics(computeLocalActivityMetrics(applications, goals));
  }, [applications, demoMode]);

  const reminders = useMemo(() => {
    const pipelineReminders = computeReminders(applications, contacts);
    const goalReminders = activityMetrics
      ? computeGoalReminders(activityMetrics)
      : [];
    return [...goalReminders, ...pipelineReminders];
  }, [applications, contacts, activityMetrics]);

  const upcomingInterviews = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return applications
      .filter((app) => {
        if (!app.interviewDate) return false;
        const d = new Date(app.interviewDate);
        d.setHours(0, 0, 0, 0);
        const diff = (d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000);
        return diff >= 0 && diff <= 14;
      })
      .sort(
        (a, b) =>
          new Date(a.interviewDate!).getTime() -
          new Date(b.interviewDate!).getTime(),
      );
  }, [applications]);

  const contactsWithNextAction = useMemo(
    () => contacts.filter((c) => isMeaningfulContactNextAction(c.nextAction)),
    [contacts],
  );

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">
            What should I do today?
          </h2>
          <p className="mt-1 text-gray-600">
            Follow-ups, interview prep, and applications needing your attention.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMetrics({ refreshStore: true })}
          disabled={metricsLoading}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-60"
        >
          <FiRefreshCw size={14} className={metricsLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <GoalsProgressPanel />

      <section>
        <h3 className="flex items-center gap-2 text-lg font-medium text-gray-800 mb-3">
          <FiAlertCircle className="text-red-500" />
          Due actions ({reminders.length})
        </h3>
        {reminders.length === 0 ? (
          <p className="text-sm text-gray-500 bg-white border rounded-lg p-4">
            No urgent actions right now. Keep logging applications and contacts.
          </p>
        ) : (
          <ul className="space-y-3">
            {reminders.map((reminder) => (
              <ReminderItem key={reminder.id} reminder={reminder} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="flex items-center gap-2 text-lg font-medium text-gray-800 mb-3">
          <FiCalendar className="text-purple-500" />
          Upcoming interviews ({upcomingInterviews.length})
        </h3>
        {upcomingInterviews.length === 0 ? (
          <p className="text-sm text-gray-500 bg-white border rounded-lg p-4">
            No interviews scheduled in the next two weeks.
          </p>
        ) : (
          <ul className="space-y-2">
            {upcomingInterviews.map((app) => (
              <li
                key={app.id}
                className="bg-white border border-purple-200 rounded-lg px-4 py-3 flex justify-between items-center"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {app.company} — {app.roleTitle}
                  </p>
                  <p className="text-sm text-purple-700">
                    {formatDate(app.interviewDate)}
                  </p>
                </div>
                <Link
                  to="/applications"
                  className="text-sm text-blue-600 hover:underline"
                >
                  View
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="flex items-center gap-2 text-lg font-medium text-gray-800 mb-3">
          <FiClock className="text-amber-500" />
          Contact next actions ({contactsWithNextAction.length})
        </h3>
        {contactsWithNextAction.length === 0 ? (
          <p className="text-sm text-gray-500 bg-white border rounded-lg p-4">
            No contact follow-ups logged.
          </p>
        ) : (
          <ul className="space-y-2">
            {contactsWithNextAction.map((contact) => {
              const app = contact.applicationId
                ? applications.find((a) => a.id === contact.applicationId)
                : null;
              const label = contactApplicationLabel({
                applicationId: contact.applicationId,
                company: contact.company || app?.company || '',
                roleTitle: app?.roleTitle,
                source: contact.source,
                linkedIn: contact.linkedIn,
              });
              return (
                <li
                  key={contact.id}
                  className="bg-white border rounded-lg px-4 py-3"
                >
                  <p className="font-medium text-gray-900">{contact.name}</p>
                  <p className="text-sm text-gray-600">{label}</p>
                  <p className="text-sm text-amber-700 mt-1">{contact.nextAction}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <DailyBriefingPanel />

      <AutomationDashboardPanel />
    </div>
  );
}

function ReminderItem({ reminder }: { reminder: Reminder }) {
  const moveApplication = useJobSearchStore((s) => s.moveApplication);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <li
      className={`border rounded-lg px-4 py-3 ${priorityStyles[reminder.priority]}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {REMINDER_TYPE_LABELS[reminder.type]}
          </p>
          <p className="font-medium text-gray-900">{reminder.title}</p>
          <p className="text-sm text-gray-600 mt-1">{reminder.description}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {reminder.type === 'stale_review' && reminder.applicationId && (
            <button
              type="button"
              onClick={() => {
                moveApplication(reminder.applicationId, 'ghosted');
                setDismissed(true);
              }}
              className="px-3 py-1.5 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-800"
            >
              Archive
            </button>
          )}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="px-3 py-1.5 text-sm text-gray-600 bg-white border rounded-lg hover:bg-gray-50"
          >
            Dismiss
          </button>
        </div>
      </div>
    </li>
  );
}
