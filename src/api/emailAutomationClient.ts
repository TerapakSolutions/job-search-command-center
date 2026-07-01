import type {
  AutomationActionResult,
  AutomationDashboardSummary,
  AuditLogEntry,
  DraftReplyResponse,
  EmailAutomationAnalysis,
  PendingApprovalEntry,
  RunAutomationResponse,
} from '../types/emailAutomation';
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

export async function fetchEmailAutomationAnalysis(
  emailId: string,
): Promise<EmailAutomationAnalysis> {
  return request<EmailAutomationAnalysis>(`/inbound-emails/${emailId}/automation`);
}

export async function createApplicationFromEmail(
  emailId: string,
): Promise<AutomationActionResult> {
  return request<AutomationActionResult>(
    `/inbound-emails/${emailId}/automation/create-application`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function createContactFromEmail(
  emailId: string,
  applicationId: string,
): Promise<AutomationActionResult> {
  return request<AutomationActionResult>(
    `/inbound-emails/${emailId}/automation/create-contact`,
    { method: 'POST', body: JSON.stringify({ applicationId }) },
  );
}

export async function updatePipelineFromEmail(
  emailId: string,
  input: { applicationId: string; status?: string; force?: boolean },
): Promise<AutomationActionResult> {
  return request<AutomationActionResult>(
    `/inbound-emails/${emailId}/automation/update-pipeline`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export async function draftReplyFromEmail(
  emailId: string,
): Promise<DraftReplyResponse> {
  return request<DraftReplyResponse>(
    `/inbound-emails/${emailId}/automation/draft-reply`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function runEmailAutomation(
  emailId: string,
  options: { applicationId?: string; force?: boolean } = {},
): Promise<RunAutomationResponse> {
  return request<RunAutomationResponse>(
    `/inbound-emails/${emailId}/automation/run`,
    { method: 'POST', body: JSON.stringify(options) },
  );
}

export async function fetchAutomationDashboard(): Promise<AutomationDashboardSummary> {
  return request<AutomationDashboardSummary>('/email-automation/dashboard');
}

export async function fetchAutomationAuditLog(
  limit = 20,
): Promise<{ items: AuditLogEntry[] }> {
  return request<{ items: AuditLogEntry[] }>(
    `/email-automation/audit?limit=${limit}`,
  );
}

export async function fetchPendingApprovals(): Promise<{
  items: PendingApprovalEntry[];
}> {
  return request<{ items: PendingApprovalEntry[] }>(
    '/email-automation/pending-approvals',
  );
}

export async function approvePendingAutomation(
  approvalId: string,
): Promise<AutomationActionResult> {
  return request<AutomationActionResult>(
    `/email-automation/pending-approvals/${approvalId}/approve`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function rejectPendingAutomation(
  approvalId: string,
): Promise<AutomationActionResult> {
  return request<AutomationActionResult>(
    `/email-automation/pending-approvals/${approvalId}/reject`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}
