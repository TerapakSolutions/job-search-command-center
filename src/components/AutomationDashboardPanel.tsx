import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiCpu, FiCheck, FiX } from 'react-icons/fi';
import {
  approvePendingAutomation,
  fetchAutomationDashboard,
  rejectPendingAutomation,
} from '../api/emailAutomationClient';
import { isDemoMode } from '../api/persistence';
import type {
  AutomationDashboardSummary,
  PendingApprovalEntry,
} from '../types/emailAutomation';

export default function AutomationDashboardPanel() {
  const demoMode = isDemoMode();
  const [summary, setSummary] = useState<AutomationDashboardSummary | null>(null);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (demoMode) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAutomationDashboard();
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load automation');
    } finally {
      setLoading(false);
    }
  }, [demoMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleResolve = async (
    approval: PendingApprovalEntry,
    decision: 'approved' | 'rejected',
  ) => {
    setResolvingId(approval.id);
    try {
      if (decision === 'approved') {
        await approvePendingAutomation(approval.id);
      } else {
        await rejectPendingAutomation(approval.id);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve approval');
    } finally {
      setResolvingId(null);
    }
  };

  if (demoMode) return null;

  const hasContent =
    summary &&
    (summary.pendingApprovals.length > 0 ||
      summary.recentActions.length > 0 ||
      summary.attentionApplications.length > 0);

  if (loading) {
    return (
      <section className="bg-white border rounded-lg p-4 text-sm text-gray-500">
        Loading AI automation activity…
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
        {error}
      </section>
    );
  }

  if (!hasContent) return null;

  return (
    <section className="bg-white border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-lg font-medium text-gray-800">
          <FiCpu className="text-blue-500" />
          AI pipeline automation
        </h3>
        <Link
          to="/inbound-emails"
          className="text-sm text-blue-600 hover:underline"
        >
          View emails
        </Link>
      </div>

      {summary!.pendingApprovals.length > 0 && (
        <div>
          <p className="text-sm font-medium text-amber-800 mb-2">
            Pending approvals ({summary!.pendingApprovals.length})
          </p>
          <ul className="space-y-2">
            {summary!.pendingApprovals.map((approval) => (
              <li
                key={approval.id}
                className="border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 text-sm"
              >
                <p className="font-medium text-gray-900">
                  {approval.company ?? 'Application'} —{' '}
                  {approval.currentStatus} → {approval.proposedStatus}
                </p>
                <p className="text-xs text-gray-600 mt-0.5">
                  {approval.reason} · {approval.confidence}% confidence
                </p>
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => void handleResolve(approval, 'approved')}
                    disabled={resolvingId === approval.id}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60"
                  >
                    <FiCheck size={12} />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleResolve(approval, 'rejected')}
                    disabled={resolvingId === approval.id}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-white disabled:opacity-60"
                  >
                    <FiX size={12} />
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary!.recentActions.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-800 mb-2">Recent AI actions</p>
          <ul className="space-y-1 text-sm text-gray-600">
            {summary!.recentActions.map((action) => (
              <li key={action.id} className="flex justify-between gap-2">
                <span>
                  {action.actionType.replace(/_/g, ' ')}
                  {action.emailSubject ? ` — ${action.emailSubject}` : ''}
                </span>
                <span className="text-xs text-gray-400 shrink-0">
                  {new Date(action.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary!.attentionApplications.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-800 mb-2">
            Applications needing attention
          </p>
          <ul className="space-y-1 text-sm">
            {summary!.attentionApplications.slice(0, 5).map((app) => (
              <li key={app.applicationId} className="text-gray-700">
                <span className="font-medium">
                  {app.company} — {app.roleTitle}
                </span>
                <span className="text-gray-500"> · {app.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
