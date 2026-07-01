import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiCheck, FiInbox, FiMail, FiRefreshCw, FiZap } from 'react-icons/fi';
import {
  classifyInboundEmail,
  classifyUnprocessedInboundEmails,
  fetchInboundEmailById,
  fetchInboundEmails,
  markInboundEmailProcessed,
} from '../api/inboundEmailsClient';
import { isDemoMode } from '../api/persistence';
import { formatDate } from '../lib/dates';
import {
  classificationBadgeClass,
  classificationPriorityLabel,
} from '../lib/inboundEmailClassification';
import type {
  InboundEmailDetail,
  InboundEmailListItem,
} from '../types/inboundEmail';

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
  const [analyzing, setAnalyzing] = useState(false);
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const [showHtml, setShowHtml] = useState(false);

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

  const handleSelect = (id: string) => {
    setSelectedId(id);
    void loadDetail(id);
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
            }
          : item,
      ),
    );
  };

  const handleAnalyze = async (force = false) => {
    if (!detail) return;
    setAnalyzing(true);
    setError(null);
    try {
      const result = await classifyInboundEmail(detail.id, { force });
      setDetail(result.email);
      syncEmailInList(result.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze email');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAnalyzeUnprocessed = async () => {
    setBatchAnalyzing(true);
    setError(null);
    try {
      await classifyUnprocessedInboundEmails();
      await loadList();
      if (selectedId) {
        await loadDetail(selectedId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze emails');
    } finally {
      setBatchAnalyzing(false);
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
              onClick={() => void handleAnalyzeUnprocessed()}
              disabled={batchAnalyzing || loading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border rounded-lg hover:bg-gray-50 disabled:opacity-60"
            >
              <FiZap size={12} />
              {batchAnalyzing ? 'Analyzing…' : 'Analyze new'}
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
                    <button
                      type="button"
                      onClick={() => void handleAnalyze(Boolean(detail.processedAt))}
                      disabled={analyzing}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-60"
                    >
                      {analyzing ? (
                        <FiRefreshCw className="animate-spin" size={14} />
                      ) : (
                        <FiZap size={14} />
                      )}
                      {detail.processedAt ? 'Re-analyze' : 'Analyze'}
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
                    {detail.suggestedAction && (
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
