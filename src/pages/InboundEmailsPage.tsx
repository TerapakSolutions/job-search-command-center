import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiCheck, FiInbox, FiMail, FiRefreshCw, FiPlay, FiUserPlus, FiBriefcase, FiTrendingUp, FiEdit3, FiList, FiTrash2 } from 'react-icons/fi';
import {
  deleteInboundEmail,
  fetchInboundEmailAuditLog,
  fetchInboundEmailById,
  fetchInboundEmails,
  markInboundEmailProcessed,
  reanalyzeInboundEmail,
  retryInboundEmailProcessing,
} from '../api/inboundEmailsClient';
import {
  approvePendingAutomation,
  createApplicationFromEmail,
  createContactFromEmail,
  draftReplyFromEmail,
  fetchEmailAutomationAnalysis,
  rejectPendingAutomation,
  runEmailAutomation,
  updatePipelineFromEmail,
} from '../api/emailAutomationClient';
import { isDemoMode } from '../api/persistence';
import { formatDate } from '../lib/dates';
import {
  classificationBadgeClass,
  classificationPriorityLabel,
} from '../lib/inboundEmailClassification';
import {
  processingStatusBadgeClass,
  processingStatusLabel,
} from '../lib/inboundEmailProcessing';
import { approvalTypeLabel } from '../lib/approvalDisplay';
import {
  PROCESSING_TIMELINE_LABELS,
  processingTimelineStatusClass,
} from '../lib/contactDisplay';
import type {
  InboundEmailDetail,
  InboundEmailListItem,
} from '../types/inboundEmail';
import type {
  AuditLogEntry,
  AutomationActionResult,
  EmailAutomationAnalysis,
} from '../types/emailAutomation';

type StatusFilter = 'all' | 'unprocessed' | 'processed';

function formatReceivedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function InboundEmailsPage() {
  const demoMode = isDemoMode();
  const [emails, setEmails] = useState<InboundEmailListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InboundEmailDetail | null>(null);
  const [loading, setLoading] = useState(!demoMode);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [showHtml, setShowHtml] = useState(false);
  const [automation, setAutomation] = useState<EmailAutomationAnalysis | null>(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationRunning, setAutomationRunning] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [draftReply, setDraftReply] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [senderFilter, setSenderFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const listFilters = useMemo(() => {
    const filters: Parameters<typeof fetchInboundEmails>[0] = { limit: 100 };
    if (statusFilter === 'processed') filters.processed = true;
    if (statusFilter === 'unprocessed') filters.processed = false;
    if (senderFilter.trim()) filters.sender = senderFilter.trim();
    if (subjectFilter.trim()) filters.subject = subjectFilter.trim();
    if (fromDate) filters.fromDate = fromDate;
    if (toDate) filters.toDate = toDate;
    return filters;
  }, [statusFilter, senderFilter, subjectFilter, fromDate, toDate]);

  const loadList = useCallback(async () => {
    if (demoMode) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchInboundEmails(listFilters);
      setEmails(result.items);
      setTotal(result.total);
      if (selectedId && !result.items.some((e) => e.id === selectedId)) {
        setSelectedId(null);
        setDetail(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load emails');
    } finally {
      setLoading(false);
    }
  }, [demoMode, listFilters, selectedId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setError(null);
    setAutomation(null);
    setDraftReply(null);
    setActionMessage(null);
    setSelectedMatchId(null);
    try {
      const result = await fetchInboundEmailById(id);
      setDetail(result);
      setShowHtml(false);
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : 'Failed to load email');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!detail || demoMode) return;
    if (
      detail.processingStatus !== 'processing' &&
      detail.processingStatus !== 'unprocessed'
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadDetail(detail.id);
      void loadList();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [detail, demoMode, loadDetail, loadList]);

  const loadAutomation = useCallback(async (id: string) => {
    setAutomationLoading(true);
    try {
      const analysis = await fetchEmailAutomationAnalysis(id);
      setAutomation(analysis);
      setSelectedMatchId(
        analysis.matches.bestMatch?.applicationId ??
          analysis.matches.matches[0]?.applicationId ??
          null,
      );
    } catch (err) {
      setAutomation(null);
      setError(err instanceof Error ? err.message : 'Failed to load automation');
    } finally {
      setAutomationLoading(false);
    }
  }, []);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setShowAuditLog(false);
    setAuditLog([]);
    void loadDetail(id);
    void loadAutomation(id);
  };

  const handleMarkReviewed = async () => {
    if (!detail) return;
    setMarking(true);
    setError(null);
    try {
      const updated = await markInboundEmailProcessed(detail.id, true);
      setDetail({ ...detail, processed: updated.processed });
      setEmails((prev) =>
        prev.map((e) => (e.id === updated.id ? { ...e, processed: true } : e)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update email');
    } finally {
      setMarking(false);
    }
  };

  const syncEmailInList = (email: InboundEmailDetail) => {
    setEmails((prev) =>
      prev.map((item) =>
        item.id === email.id
          ? {
              ...item,
              classification: email.classification,
              classificationConfidence: email.classificationConfidence,
              suggestedAction: email.suggestedAction,
              requiresResponse: email.requiresResponse,
              processedAt: email.processedAt,
              processingStatus: email.processingStatus,
              processingError: email.processingError,
              lastProcessedAt: email.lastProcessedAt,
              needsApproval: email.needsApproval,
            }
          : item,
      ),
    );
  };

  const handleReanalyze = async () => {
    if (!detail) return;
    setReanalyzing(true);
    setError(null);
    try {
      const result = await reanalyzeInboundEmail(detail.id);
      setDetail(result.email);
      syncEmailInList(result.email);
      await loadAutomation(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-analyze email');
    } finally {
      setReanalyzing(false);
    }
  };

  const handleRetryProcessing = async () => {
    if (!detail) return;
    setRetrying(true);
    setError(null);
    try {
      const result = await retryInboundEmailProcessing(detail.id);
      setDetail(result.email);
      syncEmailInList(result.email);
      await loadAutomation(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry processing');
    } finally {
      setRetrying(false);
    }
  };

  const handleViewAuditLog = async () => {
    if (!detail) return;
    setAuditLoading(true);
    setShowAuditLog(true);
    setError(null);
    try {
      const result = await fetchInboundEmailAuditLog(detail.id);
      setAuditLog(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setAuditLoading(false);
    }
  };

  const showActionResult = (result: AutomationActionResult) => {
    setActionMessage(
      result.changes?.duplicateApplicationId
        ? 'Already tracked — an application for this company already exists.'
        : result.message,
    );
    void loadAutomation(detail!.id);
  };

  const handleRunAutomation = async () => {
    if (!detail) return;
    setAutomationRunning(true);
    setError(null);
    try {
      const result = await runEmailAutomation(detail.id, {
        applicationId: selectedMatchId ?? undefined,
      });
      setAutomation(result.analysis);
      const messages = result.results.map((r) => r.message).join(' · ');
      setActionMessage(messages || 'Automation completed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Automation failed');
    } finally {
      setAutomationRunning(false);
    }
  };

  const handleCreateApplication = async () => {
    if (!detail) return;
    setAutomationRunning(true);
    try {
      const result = await createApplicationFromEmail(detail.id);
      showActionResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create application');
    } finally {
      setAutomationRunning(false);
    }
  };

  const handleCreateContact = async () => {
    if (!detail || !selectedMatchId) return;
    setAutomationRunning(true);
    try {
      const result = await createContactFromEmail(detail.id, selectedMatchId);
      showActionResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create contact');
    } finally {
      setAutomationRunning(false);
    }
  };

  const handleUpdatePipeline = async () => {
    if (!detail || !selectedMatchId) return;
    setAutomationRunning(true);
    try {
      const result = await updatePipelineFromEmail(detail.id, {
        applicationId: selectedMatchId,
      });
      showActionResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update pipeline');
    } finally {
      setAutomationRunning(false);
    }
  };

  const handleDraftReply = async () => {
    if (!detail) return;
    setAutomationRunning(true);
    try {
      const result = await draftReplyFromEmail(detail.id);
      setDraftReply(result.draft);
      setActionMessage('Draft reply generated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to draft reply');
    } finally {
      setAutomationRunning(false);
    }
  };

  const handleResolveApproval = async (
    approvalId: string,
    decision: 'approved' | 'rejected',
  ) => {
    if (!detail) return;
    setResolvingApprovalId(approvalId);
    setError(null);
    try {
      const result =
        decision === 'approved'
          ? await approvePendingAutomation(approvalId)
          : await rejectPendingAutomation(approvalId);
      setActionMessage(result.message);
      const refreshed = await fetchInboundEmailById(detail.id);
      setDetail(refreshed);
      syncEmailInList(refreshed);
      await loadAutomation(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve approval');
    } finally {
      setResolvingApprovalId(null);
    }
  };

  const handleDelete = async () => {
    if (!detail) return;
    const confirmed = window.confirm(
      'Delete this email only? Applications, contacts, and communications will not be changed.',
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    try {
      await deleteInboundEmail(detail.id);
      setSelectedId(null);
      setDetail(null);
      setAutomation(null);
      setDraftReply(null);
      setShowAuditLog(false);
      setAuditLog([]);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete email');
    } finally {
      setDeleting(false);
    }
  };

  if (demoMode) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Inbound Emails</h2>
          <p className="text-gray-600 mt-1">
            View recruiter and job-search emails received via Postmark.
          </p>
        </div>
        <section className="bg-white border rounded-lg p-6 text-sm text-gray-600">
          <div className="flex items-center gap-2 text-gray-800 font-medium">
            <FiInbox />
            API mode required
          </div>
          <p className="mt-2">
            Inbound email viewing requires API mode with Google sign-in and Postmark
            webhook configuration. Switch to API persistence to use this feature.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Inbound Emails</h2>
        <p className="text-gray-600 mt-1">
          Recruiter and job-search emails received at your Postmark inbound address.
        </p>
      </div>

      <div className="bg-white border rounded-lg p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All</option>
            <option value="unprocessed">Unreviewed</option>
            <option value="processed">Reviewed</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">Sender</span>
          <input
            type="text"
            value={senderFilter}
            onChange={(e) => setSenderFilter(e.target.value)}
            placeholder="Filter by sender"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">Subject</span>
          <input
            type="text"
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            placeholder="Filter by subject"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">From date</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">To date</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
        </label>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-4 min-h-[480px]">
        <section className="lg:col-span-2 bg-white border rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b text-sm text-gray-600 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <FiMail size={14} />
              {total} email{total === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={() => void loadList()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border rounded-lg hover:bg-gray-50 disabled:opacity-60"
            >
              <FiRefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="p-6 text-sm text-gray-500">Loading inbound emails…</p>
          ) : emails.length === 0 ? (
            <p className="p-6 text-sm text-gray-500 text-center">
              No inbound emails match your filters.
            </p>
          ) : (
            <ul className="divide-y overflow-y-auto flex-1">
              {emails.map((email) => {
                const isSelected = email.id === selectedId;
                const isUnread = !email.processed;
                return (
                  <li key={email.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(email.id)}
                      className={`w-full text-left px-4 py-3 transition hover:bg-gray-50 ${
                        isSelected ? 'bg-blue-50 border-l-4 border-blue-600' : ''
                      } ${isUnread ? 'font-medium' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className={`text-sm truncate ${
                            isUnread ? 'text-gray-900' : 'text-gray-700'
                          }`}
                        >
                          {email.fromEmail || 'Unknown sender'}
                        </span>
                        {isUnread && (
                          <span className="shrink-0 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                            New
                          </span>
                        )}
                      </div>
                      <p
                        className={`text-sm truncate mt-0.5 ${
                          isUnread ? 'text-gray-900' : 'text-gray-600'
                        }`}
                      >
                        {email.subject || '(No subject)'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {formatReceivedAt(email.receivedAt)}
                        {email.processed && ' · Reviewed'}
                      </p>
                      {email.classification && (
                        <span
                          className={`inline-block mt-2 text-xs px-2 py-0.5 rounded-full border ${classificationBadgeClass(email.classification)}`}
                        >
                          {email.classification}
                        </span>
                      )}
                      <span
                        className={`inline-block mt-2 ml-1 text-xs px-2 py-0.5 rounded-full border ${processingStatusBadgeClass(email.processingStatus, email.needsApproval)}`}
                      >
                        {processingStatusLabel(
                          email.processingStatus,
                          email.needsApproval,
                          email.approvalItems,
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="lg:col-span-3 bg-white border rounded-lg overflow-hidden flex flex-col">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center p-8 text-sm text-gray-500">
              Select an email to view its contents.
            </div>
          ) : detailLoading ? (
            <p className="p-6 text-sm text-gray-500">Loading email…</p>
          ) : detail ? (
            <>
              <div className="px-5 py-4 border-b space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {detail.subject || '(No subject)'}
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">
                      From {detail.fromEmail || 'Unknown'} · To {detail.toEmail || '—'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Received {formatDate(detail.receivedAt)} (
                      {formatReceivedAt(detail.receivedAt)})
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-end gap-2 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border ${processingStatusBadgeClass(detail.processingStatus, detail.needsApproval)}`}
                    >
                      {(detail.processingStatus === 'processing' ||
                        reanalyzing ||
                        retrying) && (
                        <FiRefreshCw className="animate-spin" size={14} />
                      )}
                      {processingStatusLabel(
                        detail.processingStatus,
                        detail.needsApproval,
                        detail.pendingApprovals,
                      )}
                    </span>
                    {(detail.processingStatus === 'processed' ||
                      detail.processingStatus === 'failed') && (
                      <button
                        type="button"
                        onClick={() => void handleReanalyze()}
                        disabled={reanalyzing}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-60"
                      >
                        <FiRefreshCw size={14} className={reanalyzing ? 'animate-spin' : ''} />
                        Re-analyze
                      </button>
                    )}
                    {detail.processingStatus === 'failed' && (
                      <button
                        type="button"
                        onClick={() => void handleRetryProcessing()}
                        disabled={retrying}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-red-200 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-60"
                      >
                        <FiRefreshCw size={14} className={retrying ? 'animate-spin' : ''} />
                        Retry failed processing
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleViewAuditLog()}
                      disabled={auditLoading}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-60"
                    >
                      <FiList size={14} />
                      View audit log
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete()}
                      disabled={deleting}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-red-200 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-60"
                    >
                      <FiTrash2 size={14} />
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                    {!detail.processed && (
                      <button
                        type="button"
                        onClick={() => void handleMarkReviewed()}
                        disabled={marking}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60"
                      >
                        <FiCheck />
                        Mark reviewed
                      </button>
                    )}
                    {detail.processed && (
                      <span className="inline-flex items-center gap-1 text-sm text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">
                        <FiCheck size={14} />
                        Reviewed
                      </span>
                    )}
                  </div>
                </div>

                {detail.processingError && (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    Processing error: {detail.processingError}
                  </div>
                )}

                {detail.forwarded?.isForwarded && (
                  <div className="rounded-lg border bg-white p-4 space-y-2">
                    <h4 className="text-sm font-semibold text-gray-900">Forwarded email</h4>
                    <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                      <dt className="font-medium">Forwarded by</dt>
                      <dd>{detail.forwarded.forwardedByEmail}</dd>
                      {detail.forwarded.originalSenderEmail && (
                        <>
                          <dt className="font-medium">Original sender</dt>
                          <dd>
                            {detail.forwarded.originalSenderName
                              ? `${detail.forwarded.originalSenderName} <${detail.forwarded.originalSenderEmail}>`
                              : detail.forwarded.originalSenderEmail}
                          </dd>
                        </>
                      )}
                      {detail.forwarded.originalSubject && (
                        <>
                          <dt className="font-medium">Original subject</dt>
                          <dd>{detail.forwarded.originalSubject}</dd>
                        </>
                      )}
                      {detail.forwarded.originalCompany && (
                        <>
                          <dt className="font-medium">Original company</dt>
                          <dd>{detail.forwarded.originalCompany}</dd>
                        </>
                      )}
                    </dl>
                  </div>
                )}

                {detail.needsApproval && detail.pendingApprovals.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                    <h4 className="text-sm font-semibold text-amber-900">
                      Approval details
                    </h4>
                    <ul className="space-y-3">
                      {detail.pendingApprovals.map((approval) => (
                        <li
                          key={approval.id}
                          className="rounded-lg border border-amber-200 bg-white p-3 space-y-2"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              {approval.label ||
                                approvalTypeLabel(approval.approvalType)}
                            </span>
                            <span className="text-xs text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                              {approval.aiConfidence}% confidence
                              {approval.aiConfidence < approval.autoApprovalThreshold &&
                                ` (needs ${approval.autoApprovalThreshold}%+)`}
                            </span>
                          </div>
                          <p className="text-sm text-gray-700">{approval.reasonMessage}</p>
                          <p className="text-xs text-gray-600">
                            <span className="font-medium">Why automation stopped: </span>
                            {approval.stopReason}
                          </p>
                          <p className="text-xs text-gray-600">
                            <span className="font-medium">Suggested action: </span>
                            {approval.suggestedAction}
                          </p>
                          {approval.currentStatus && approval.proposedStatus && (
                            <p className="text-xs text-gray-600">
                              Pipeline: {approval.currentStatus.replace(/_/g, ' ')} →{' '}
                              {approval.proposedStatus.replace(/_/g, ' ')}
                            </p>
                          )}
                          {approval.candidateMatches.length > 0 && (
                            <ul className="text-xs text-gray-600 space-y-1">
                              <li className="font-medium">Candidate matches:</li>
                              {approval.candidateMatches.map((match) => (
                                <li key={match.applicationId}>
                                  {match.company} — {match.roleTitle} ({match.confidence}%)
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="flex gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() =>
                                void handleResolveApproval(approval.id, 'approved')
                              }
                              disabled={resolvingApprovalId === approval.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60"
                            >
                              <FiCheck size={12} />
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleResolveApproval(approval.id, 'rejected')
                              }
                              disabled={resolvingApprovalId === approval.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border rounded-lg hover:bg-gray-50 disabled:opacity-60"
                            >
                              Reject
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {detail.processingTimeline?.steps &&
                  detail.processingTimeline.steps.length > 0 && (
                    <div className="rounded-lg border bg-white p-4 space-y-3">
                      <h4 className="text-sm font-semibold text-gray-900">
                        Processing timeline
                      </h4>
                      <ul className="space-y-2">
                        {detail.processingTimeline.steps.map((step) => (
                          <li
                            key={step.step}
                            className={`text-xs border rounded px-3 py-2 ${processingTimelineStatusClass(step.status)}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-medium">
                                {PROCESSING_TIMELINE_LABELS[step.step] ?? step.step}
                              </span>
                              <span className="uppercase text-[10px]">{step.status}</span>
                            </div>
                            {step.message && (
                              <p className="mt-1 text-gray-700">{step.message}</p>
                            )}
                            {step.timestamp && (
                              <p className="mt-0.5 text-gray-500">
                                {formatReceivedAt(step.timestamp)}
                              </p>
                            )}
                            {step.error && (
                              <p className="mt-1 text-red-700">Error: {step.error}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {showAuditLog && (
                  <div className="rounded-lg border bg-white p-4 space-y-2">
                    <h4 className="text-sm font-semibold text-gray-900">Audit log</h4>
                    {auditLoading ? (
                      <p className="text-sm text-gray-500">Loading audit log…</p>
                    ) : auditLog.length === 0 ? (
                      <p className="text-sm text-gray-500">No audit entries yet.</p>
                    ) : (
                      <ul className="space-y-2 max-h-48 overflow-y-auto">
                        {auditLog.map((entry) => (
                          <li
                            key={entry.id}
                            className="text-xs border rounded p-2 text-gray-700"
                          >
                            <span className="font-medium">{entry.actionType}</span>
                            {' · '}
                            {entry.status}
                            {' · '}
                            {formatReceivedAt(entry.createdAt)}
                            {typeof entry.details.reasonMessage === 'string' && (
                              <p className="mt-1 text-gray-600">{entry.details.reasonMessage}</p>
                            )}
                            {typeof entry.details.userDecision === 'string' && (
                              <p className="mt-0.5 text-gray-600">
                                Decision: {entry.details.userDecision}
                                {entry.confidence != null && ` · ${entry.confidence}% confidence`}
                              </p>
                            )}
                            {typeof entry.details.suggestedAction === 'string' && (
                              <p className="mt-0.5 text-gray-500">
                                Suggested: {entry.details.suggestedAction}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {(detail.classification || detail.aiSummary || detail.suggestedAction) && (
                  <div className="rounded-lg border bg-gray-50 p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {detail.classification && (
                        <span
                          className={`text-xs font-medium px-2.5 py-1 rounded-full border ${classificationBadgeClass(detail.classification)}`}
                        >
                          {detail.classification}
                          {detail.classificationConfidence != null &&
                            ` · ${detail.classificationConfidence}%`}
                        </span>
                      )}
                      {classificationPriorityLabel(
                        detail.classification,
                        detail.requiresResponse,
                      ) && (
                        <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                          {classificationPriorityLabel(
                            detail.classification,
                            detail.requiresResponse,
                          )}
                        </span>
                      )}
                    </div>
                    {detail.aiSummary && (
                      <p className="text-sm text-gray-700">{detail.aiSummary}</p>
                    )}
                    {detail.suggestedAction &&
                      !(
                        automation?.canOfferApplicationCreation &&
                        /no action needed/i.test(detail.suggestedAction)
                      ) && (
                      <p className="text-sm">
                        <span className="font-medium text-gray-800">Suggested action: </span>
                        <span className="text-gray-700">{detail.suggestedAction}</span>
                      </p>
                    )}
                    {(detail.companyName ||
                      detail.positionTitle ||
                      detail.recruiterName ||
                      detail.interviewDatetime) && (
                      <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                        {detail.companyName && (
                          <>
                            <dt className="font-medium">Company</dt>
                            <dd>{detail.companyName}</dd>
                          </>
                        )}
                        {detail.positionTitle && (
                          <>
                            <dt className="font-medium">Role</dt>
                            <dd>{detail.positionTitle}</dd>
                          </>
                        )}
                        {detail.recruiterName && (
                          <>
                            <dt className="font-medium">Recruiter</dt>
                            <dd>{detail.recruiterName}</dd>
                          </>
                        )}
                        {detail.interviewDatetime && (
                          <>
                            <dt className="font-medium">Interview</dt>
                            <dd>{formatReceivedAt(detail.interviewDatetime)}</dd>
                          </>
                        )}
                      </dl>
                    )}
                  </div>
                )}

                {(detail.processingStatus === 'processed' || detail.processedAt) && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-gray-900">
                        Pipeline automation
                      </h4>
                      <button
                        type="button"
                        onClick={() => void handleRunAutomation()}
                        disabled={automationRunning || automationLoading}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
                      >
                        <FiPlay size={12} />
                        {automationRunning ? 'Running…' : 'Run all'}
                      </button>
                    </div>

                    {actionMessage && (
                      <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1.5">
                        {actionMessage}
                      </p>
                    )}

                    {automationLoading ? (
                      <p className="text-sm text-gray-500">Loading matches…</p>
                    ) : automation ? (
                      <>
                        {automation.matches.matches.length > 0 ? (
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-gray-700">
                              Application matches
                              {automation.matches.requiresManualSelection &&
                                ' — select the correct match'}
                            </p>
                            <ul className="space-y-1.5">
                              {automation.matches.matches.map((match) => (
                                <li key={match.applicationId}>
                                  <label className="flex items-start gap-2 text-xs cursor-pointer">
                                    <input
                                      type="radio"
                                      name="application-match"
                                      checked={selectedMatchId === match.applicationId}
                                      onChange={() =>
                                        setSelectedMatchId(match.applicationId)
                                      }
                                      className="mt-0.5"
                                    />
                                    <span>
                                      <span className="font-medium text-gray-900">
                                        {match.company} — {match.roleTitle}
                                      </span>
                                      <span className="text-gray-500 ml-1">
                                        ({match.status}) · {match.confidence}% confidence
                                      </span>
                                      {match.matchReasons.length > 0 && (
                                        <span className="block text-gray-500">
                                          {match.matchReasons.join('; ')}
                                        </span>
                                      )}
                                    </span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-600">
                            No matching applications found.
                            {automation.canOfferApplicationCreation &&
                              ' You can create a new application from this email.'}
                          </p>
                        )}

                        {automation.nextActions.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-gray-700 mb-1.5">
                              Suggested next actions
                            </p>
                            <ul className="space-y-1">
                              {automation.nextActions.map((action) => (
                                <li
                                  key={action.type}
                                  className="text-xs text-gray-700 flex items-start gap-2"
                                >
                                  <span
                                    className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] uppercase ${
                                      action.priority === 'high'
                                        ? 'bg-red-100 text-red-700'
                                        : action.priority === 'medium'
                                          ? 'bg-amber-100 text-amber-700'
                                          : 'bg-gray-100 text-gray-600'
                                    }`}
                                  >
                                    {action.priority}
                                  </span>
                                  <span>
                                    <span className="font-medium">{action.label}: </span>
                                    {action.description}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 pt-1">
                          {automation.canOfferApplicationCreation && (
                            <button
                              type="button"
                              onClick={() => void handleCreateApplication()}
                              disabled={automationRunning}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border rounded-lg hover:bg-white disabled:opacity-60"
                            >
                              <FiBriefcase size={12} />
                              Create application
                            </button>
                          )}
                          {selectedMatchId && (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleCreateContact()}
                                disabled={automationRunning}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border rounded-lg hover:bg-white disabled:opacity-60"
                              >
                                <FiUserPlus size={12} />
                                Create contact
                              </button>
                              {automation.pipelineProposal && (
                                <button
                                  type="button"
                                  onClick={() => void handleUpdatePipeline()}
                                  disabled={automationRunning}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border rounded-lg hover:bg-white disabled:opacity-60"
                                >
                                  <FiTrendingUp size={12} />
                                  Update pipeline
                                </button>
                              )}
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleDraftReply()}
                            disabled={automationRunning}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border rounded-lg hover:bg-white disabled:opacity-60"
                          >
                            <FiEdit3 size={12} />
                            Draft reply
                          </button>
                        </div>

                        {draftReply && (
                          <div className="mt-2">
                            <p className="text-xs font-medium text-gray-700 mb-1">
                              Draft reply
                            </p>
                            <pre className="whitespace-pre-wrap text-xs text-gray-800 bg-white border rounded p-2 font-sans">
                              {draftReply}
                            </pre>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-gray-500">
                        Processing complete — review automation suggestions below.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="px-5 py-4 border-b flex items-center gap-3 text-sm">
                <button
                  type="button"
                  onClick={() => setShowHtml(false)}
                  className={`px-3 py-1 rounded-lg ${
                    !showHtml
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Plain text
                </button>
                {detail.htmlBody && (
                  <button
                    type="button"
                    onClick={() => setShowHtml(true)}
                    className={`px-3 py-1 rounded-lg ${
                      showHtml
                        ? 'bg-gray-900 text-white'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    HTML preview
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-auto p-5">
                {showHtml && detail.htmlBody ? (
                  <iframe
                    title="Email HTML preview"
                    sandbox=""
                    srcDoc={detail.htmlBody}
                    className="w-full min-h-[320px] border rounded-lg bg-white"
                  />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans">
                    {detail.textBody || 'No plain text body.'}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <p className="p-6 text-sm text-gray-500">Email not found.</p>
          )}
        </section>
      </div>
    </div>
  );
}
