import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { applications, contacts, emailAutomationPendingApprovals, inboundEmails, users } from '../db/schema.js';
import {
  approvalReasonFromLegacyRow,
  approvalTypeLabel,
} from './approvalReason.js';
import {
  formatApprovalTypeLabel,
  formatPipelineApprovalLabel,
} from './emailAutomationMessages.js';
import type { ProcessingStatus } from './inboundEmailProcessingTypes.js';
import { ProcessingTimelineBuilder } from './processingTimeline.js';
import { nowIso } from './id.js';

export interface InboundEmailListItem {
  id: string;
  subject: string;
  fromEmail: string;
  toEmail: string;
  receivedAt: string;
  processed: boolean;
  classification: string | null;
  classificationConfidence: number | null;
  suggestedAction: string | null;
  requiresResponse: boolean | null;
  processedAt: string | null;
  processingStatus: ProcessingStatus;
  processingError: string | null;
  lastProcessedAt: string | null;
  needsApproval: boolean;
  approvalItems?: PendingApprovalSummary[];
}

export interface PendingApprovalSummary {
  id: string;
  approvalType: string;
  label: string;
  reason: string;
  reasonCode: string;
  reasonMessage: string;
  suggestedAction: string;
  aiConfidence: number;
  autoApprovalThreshold: number;
  stopReason: string;
  candidateMatches: Array<{
    applicationId: string;
    company: string;
    roleTitle: string;
    status: string;
    confidence: number;
    matchReasons: string[];
  }>;
  proposedStatus: string;
  currentStatus: string | null;
  company?: string;
  roleTitle?: string;
}

export interface ForwardedEmailSummary {
  isForwarded: boolean;
  forwardedByEmail: string;
  originalSenderEmail: string | null;
  originalSenderName: string | null;
  originalSubject: string | null;
  originalRecipient: string | null;
  originalSentAt: string | null;
  originalCompany: string | null;
}

export interface InboundEmailDetail extends InboundEmailListItem {
  provider: string;
  textBody: string;
  htmlBody: string | null;
  companyName: string | null;
  positionTitle: string | null;
  recruiterName: string | null;
  actionDueAt: string | null;
  interviewDetected: boolean | null;
  interviewDatetime: string | null;
  aiSummary: string | null;
  processingStartedAt: string | null;
  processingCompletedAt: string | null;
  processingAttempts: number;
  forwarded: ForwardedEmailSummary;
  processingTimeline: ReturnType<typeof ProcessingTimelineBuilder.parse>;
  pendingApprovals: PendingApprovalSummary[];
}

export interface ListInboundEmailsOptions {
  limit?: number;
  offset?: number;
  processed?: boolean;
  sender?: string;
  subject?: string;
  fromDate?: string;
  toDate?: string;
  // 'Not Job Related' emails (bills, newsletters) are hidden unless asked for.
  includeNotJobRelated?: boolean;
}

export interface ListInboundEmailsResult {
  items: InboundEmailListItem[];
  total: number;
  hiddenCount: number;
  limit: number;
  offset: number;
}

export function getUserEmailContext(db: Db, userId: string) {
  const userRows = db.select().from(users).where(eq(users.id, userId)).all();
  const userEmail = userRows[0]?.email?.trim().toLowerCase() ?? '';

  const userContacts = db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, userId))
    .all();

  const contactEmails = new Set(
    userContacts.map((c) => c.email.trim().toLowerCase()).filter(Boolean),
  );

  const otherUserEmails = new Set(
    db
      .select({ id: users.id, email: users.email })
      .from(users)
      .all()
      .filter((u) => u.id !== userId)
      .map((u) => u.email.trim().toLowerCase())
      .filter(Boolean),
  );

  return { userEmail, contactEmails, otherUserEmails };
}

/** Every address in a header value such as `Dan <dan@x.com>, a@y.com`, lowercased. */
export function emailAddressesIn(header: string): string[] {
  return (header.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []);
}

export function isInboundEmailDeleted(
  email: Pick<typeof inboundEmails.$inferSelect, 'deletedAt'>,
): boolean {
  return email.deletedAt != null;
}

export function inboundEmailBelongsToUser(
  email: typeof inboundEmails.$inferSelect,
  userEmail: string,
  contactEmails: Set<string>,
  otherUserEmails: Set<string>,
): boolean {
  const from = email.fromEmail.trim().toLowerCase();
  const to = emailAddressesIn(email.toEmail);
  if (userEmail && (from === userEmail || to.includes(userEmail))) {
    return true;
  }
  // Several people share the inbound address: an email carrying another
  // user's address is theirs, even if this user saved them as a contact.
  if (otherUserEmails.has(from) || to.some((a) => otherUserEmails.has(a))) {
    return false;
  }
  return contactEmails.has(from);
}

function emailNeedsApproval(
  db: Db,
  emailId: string,
  processingStatus: string,
): boolean {
  if (processingStatus !== 'processed') return false;
  const rows = db
    .select()
    .from(emailAutomationPendingApprovals)
    .where(eq(emailAutomationPendingApprovals.inboundEmailId, emailId))
    .all();
  return rows.some((row) => row.status === 'pending');
}

function listPendingApprovalsForEmail(
  db: Db,
  emailId: string,
): PendingApprovalSummary[] {
  const rows = db
    .select()
    .from(emailAutomationPendingApprovals)
    .where(eq(emailAutomationPendingApprovals.inboundEmailId, emailId))
    .all();

  return rows
    .filter((row) => row.status === 'pending')
    .map((row) => {
      const details = approvalReasonFromLegacyRow({
        approvalType: row.approvalType,
        reason: row.reason,
        confidence: row.confidence,
        suggestedAction: row.suggestedAction,
        detailsJson: row.detailsJson,
      });
      let label = approvalTypeLabel(details.approvalType);
      if (row.approvalType === 'pipeline_update') {
        label = formatPipelineApprovalLabel(row.proposedStatus, row.currentStatus);
      } else if (row.approvalType !== details.approvalType) {
        label = formatApprovalTypeLabel(row.approvalType);
      }
      let company: string | undefined;
      let roleTitle: string | undefined;
      if (row.applicationId) {
        const appRows = db
          .select({ company: applications.company, roleTitle: applications.roleTitle })
          .from(applications)
          .where(eq(applications.id, row.applicationId))
          .all();
        company = appRows[0]?.company;
        roleTitle = appRows[0]?.roleTitle;
      }
      return {
        id: row.id,
        approvalType: details.approvalType,
        label,
        reason: row.reason,
        reasonCode: details.reasonCode,
        reasonMessage: details.reasonMessage,
        suggestedAction: details.suggestedAction,
        aiConfidence: details.aiConfidence,
        autoApprovalThreshold: details.autoApprovalThreshold,
        stopReason: details.stopReason,
        candidateMatches: details.candidateMatches ?? [],
        proposedStatus: row.proposedStatus,
        currentStatus: row.currentStatus,
        company,
        roleTitle,
      };
    });
}

function toListItem(
  db: Db,
  row: typeof inboundEmails.$inferSelect,
): InboundEmailListItem {
  const needsApproval = emailNeedsApproval(db, row.id, row.processingStatus);
  return {
    id: row.id,
    subject: row.subject,
    fromEmail: row.fromEmail,
    toEmail: row.toEmail,
    receivedAt: row.receivedAt,
    processed: row.processed,
    classification: row.classification,
    classificationConfidence: row.classificationConfidence,
    suggestedAction: row.suggestedAction,
    requiresResponse: row.requiresResponse,
    processedAt: row.processedAt,
    processingStatus: row.processingStatus as ProcessingStatus,
    processingError: row.processingError,
    lastProcessedAt: row.lastProcessedAt,
    needsApproval,
    approvalItems: needsApproval ? listPendingApprovalsForEmail(db, row.id) : undefined,
  };
}

function extractBodies(payloadJson: string): { textBody: string; htmlBody: string | null } {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const textBody = typeof payload.TextBody === 'string' ? payload.TextBody : '';
    const htmlBody = typeof payload.HtmlBody === 'string' ? payload.HtmlBody : null;
    return { textBody, htmlBody };
  } catch {
    return { textBody: '', htmlBody: null };
  }
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// A date-only filter value means that calendar day in server local time;
// `new Date('YYYY-MM-DD')` would read it as UTC midnight instead.
function parseFilterDate(value: string): Date | null {
  return parseDate(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
}

function matchesFilters(
  row: typeof inboundEmails.$inferSelect,
  options: ListInboundEmailsOptions,
): boolean {
  if (options.processed !== undefined && row.processed !== options.processed) {
    return false;
  }
  if (options.sender) {
    const needle = options.sender.trim().toLowerCase();
    if (!row.fromEmail.toLowerCase().includes(needle)) return false;
  }
  if (options.subject) {
    const needle = options.subject.trim().toLowerCase();
    if (!row.subject.toLowerCase().includes(needle)) return false;
  }
  if (options.fromDate) {
    const received = parseDate(row.receivedAt);
    const from = parseFilterDate(options.fromDate);
    if (!received || !from || received < from) return false;
  }
  if (options.toDate) {
    const received = parseDate(row.receivedAt);
    const to = parseFilterDate(options.toDate);
    if (!received || !to) return false;
    const endOfDay = new Date(to);
    endOfDay.setHours(23, 59, 59, 999);
    if (received > endOfDay) return false;
  }
  return true;
}

export function listInboundEmailsForUser(
  db: Db,
  userId: string,
  options: ListInboundEmailsOptions = {},
): ListInboundEmailsResult {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const { userEmail, contactEmails, otherUserEmails } = getUserEmailContext(db, userId);

  const filtered = db
    .select()
    .from(inboundEmails)
    .all()
    .filter((row) => !isInboundEmailDeleted(row))
    .filter((row) => inboundEmailBelongsToUser(row, userEmail, contactEmails, otherUserEmails))
    .filter((row) => matchesFilters(row, options));
  const isHidden = (row: typeof inboundEmails.$inferSelect) =>
    !options.includeNotJobRelated && row.classification === 'Not Job Related';
  const hiddenCount = filtered.filter(isHidden).length;
  const matched = filtered
    .filter((row) => !isHidden(row))
    .sort(
      (a, b) =>
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    );

  const total = matched.length;
  const items = matched.slice(offset, offset + limit).map((row) => toListItem(db, row));

  return { items, total, hiddenCount, limit, offset };
}

export function getInboundEmailDetailForUser(
  db: Db,
  userId: string,
  id: string,
): InboundEmailDetail | null {
  const { userEmail, contactEmails, otherUserEmails } = getUserEmailContext(db, userId);
  const rows = db
    .select()
    .from(inboundEmails)
    .where(eq(inboundEmails.id, id))
    .limit(1)
    .all();
  const row = rows[0];
  if (
    !row ||
    isInboundEmailDeleted(row) ||
    !inboundEmailBelongsToUser(row, userEmail, contactEmails, otherUserEmails)
  ) {
    return null;
  }

  const { textBody, htmlBody } = extractBodies(row.payload);
  return {
    ...toListItem(db, row),
    provider: row.provider,
    textBody,
    htmlBody,
    companyName: row.companyName,
    positionTitle: row.positionTitle,
    recruiterName: row.recruiterName,
    actionDueAt: row.actionDueAt,
    interviewDetected: row.interviewDetected,
    interviewDatetime: row.interviewDatetime,
    aiSummary: row.aiSummary,
    processingStartedAt: row.processingStartedAt,
    processingCompletedAt: row.processingCompletedAt,
    processingAttempts: row.processingAttempts,
    forwarded: {
      isForwarded: row.isForwarded ?? false,
      forwardedByEmail: row.fromEmail,
      originalSenderEmail: row.originalSenderEmail,
      originalSenderName: row.originalSenderName,
      originalSubject: row.originalSubject,
      originalRecipient: row.originalRecipient,
      originalSentAt: row.originalSentAt,
      originalCompany: row.originalCompany,
    },
    processingTimeline: ProcessingTimelineBuilder.parse(row.processingTimelineJson),
    pendingApprovals: listPendingApprovalsForEmail(db, row.id),
  };
}

export function markInboundEmailProcessedForUser(
  db: Db,
  userId: string,
  id: string,
  processed: boolean,
): InboundEmailListItem | null {
  const { userEmail, contactEmails, otherUserEmails } = getUserEmailContext(db, userId);
  const rows = db
    .select()
    .from(inboundEmails)
    .where(eq(inboundEmails.id, id))
    .limit(1)
    .all();
  const row = rows[0];
  if (
    !row ||
    isInboundEmailDeleted(row) ||
    !inboundEmailBelongsToUser(row, userEmail, contactEmails, otherUserEmails)
  ) {
    return null;
  }

  const timestamp = nowIso();
  db.update(inboundEmails)
    .set({ processed, updatedAt: timestamp })
    .where(eq(inboundEmails.id, id))
    .run();

  return toListItem(db, { ...row, processed, updatedAt: timestamp });
}

export function softDeleteInboundEmailForUser(
  db: Db,
  userId: string,
  id: string,
): boolean {
  const { userEmail, contactEmails, otherUserEmails } = getUserEmailContext(db, userId);
  const rows = db
    .select()
    .from(inboundEmails)
    .where(eq(inboundEmails.id, id))
    .limit(1)
    .all();
  const row = rows[0];
  if (
    !row ||
    isInboundEmailDeleted(row) ||
    !inboundEmailBelongsToUser(row, userEmail, contactEmails, otherUserEmails)
  ) {
    return false;
  }

  const timestamp = nowIso();
  db.update(inboundEmails)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(eq(inboundEmails.id, id))
    .run();

  return true;
}
