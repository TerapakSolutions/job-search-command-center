import type { AuditLogEntry } from '../types/emailAutomation';
import type {
  ClassifyInboundEmailResponse,
  ClassifyUnprocessedResponse,
  InboundEmailDetail,
  InboundEmailFilters,
  InboundEmailListItem,
  InboundEmailListResponse,
  InboundEmailProcessingResponse,
} from '../types/inboundEmail';
import { getApiBaseUrl } from './persistence';

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Request failed: ${res.status}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

function buildQuery(filters: InboundEmailFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  if (filters.processed !== undefined) {
    params.set('processed', String(filters.processed));
  }
  if (filters.sender) params.set('sender', filters.sender);
  if (filters.subject) params.set('subject', filters.subject);
  if (filters.fromDate) params.set('fromDate', filters.fromDate);
  if (filters.toDate) params.set('toDate', filters.toDate);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function fetchInboundEmails(
  filters: InboundEmailFilters = {},
): Promise<InboundEmailListResponse> {
  return request<InboundEmailListResponse>(
    `/inbound-emails${buildQuery(filters)}`,
  );
}

export async function fetchInboundEmailById(id: string): Promise<InboundEmailDetail> {
  return request<InboundEmailDetail>(`/inbound-emails/${id}`);
}

export async function markInboundEmailProcessed(
  id: string,
  processed: boolean,
): Promise<InboundEmailListItem> {
  return request<InboundEmailListItem>(`/inbound-emails/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ processed }),
  });
}

export async function classifyInboundEmail(
  id: string,
  options: { force?: boolean } = {},
): Promise<ClassifyInboundEmailResponse> {
  return request<ClassifyInboundEmailResponse>(`/inbound-emails/${id}/classify`, {
    method: 'POST',
    body: JSON.stringify({ force: options.force ?? false }),
  });
}

export async function reanalyzeInboundEmail(
  id: string,
): Promise<InboundEmailProcessingResponse> {
  return request<InboundEmailProcessingResponse>(`/inbound-emails/${id}/reanalyze`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function retryInboundEmailProcessing(
  id: string,
): Promise<InboundEmailProcessingResponse> {
  return request<InboundEmailProcessingResponse>(
    `/inbound-emails/${id}/retry-processing`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
}

export async function fetchInboundEmailAuditLog(
  id: string,
  limit = 50,
): Promise<{ items: AuditLogEntry[] }> {
  return request<{ items: AuditLogEntry[] }>(
    `/inbound-emails/${id}/audit?limit=${limit}`,
  );
}

export async function classifyUnprocessedInboundEmails(
  limit = 20,
): Promise<ClassifyUnprocessedResponse> {
  return request<ClassifyUnprocessedResponse>(
    '/inbound-emails/classify-unprocessed',
    {
      method: 'POST',
      body: JSON.stringify({ limit }),
    },
  );
}
