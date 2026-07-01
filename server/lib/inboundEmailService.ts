import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { contacts, emailAutomationPendingApprovals, inboundEmails, users } from '../db/schema.js';
import type { ProcessingStatus } from './inboundEmailProcessingTypes.js';
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
}

export interface ListInboundEmailsOptions {
  limit?: number;
  offset?: number;
  processed?: boolean;
  sender?: string;
  subject?: string;
  fromDate?: string;
  toDate?: string;
}

export interface ListInboundEmailsResult {
  items: InboundEmailListItem[];
  total: number;
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

  return { userEmail, contactEmails };
}

export function inboundEmailBelongsToUser(
  email: typeof inboundEmails.$inferSelect,
  userEmail: string,
  contactEmails: Set<string>,
): boolean {
  const to = email.toEmail.toLowerCase();
  const from = email.fromEmail.toLowerCase();
  if (userEmail && (to.includes(userEmail) || from === userEmail)) {
    return true;
  }
  if (contactEmails.has(from)) return true;
  return false;
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

function toListItem(
  db: Db,
  row: typeof inboundEmails.$inferSelect,
): InboundEmailListItem {
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
    needsApproval: emailNeedsApproval(db, row.id, row.processingStatus),
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
    const from = parseDate(options.fromDate);
    if (!received || !from || received < from) return false;
  }
  if (options.toDate) {
    const received = parseDate(row.receivedAt);
    const to = parseDate(options.toDate);
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
  const { userEmail, contactEmails } = getUserEmailContext(db, userId);

  const matched = db
    .select()
    .from(inboundEmails)
    .all()
    .filter((row) => inboundEmailBelongsToUser(row, userEmail, contactEmails))
    .filter((row) => matchesFilters(row, options))
    .sort(
      (a, b) =>
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    );

  const total = matched.length;
  const items = matched.slice(offset, offset + limit).map((row) => toListItem(db, row));

  return { items, total, limit, offset };
}

export function getInboundEmailDetailForUser(
  db: Db,
  userId: string,
  id: string,
): InboundEmailDetail | null {
  const { userEmail, contactEmails } = getUserEmailContext(db, userId);
  const rows = db
    .select()
    .from(inboundEmails)
    .where(eq(inboundEmails.id, id))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row || !inboundEmailBelongsToUser(row, userEmail, contactEmails)) {
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
  };
}

export function markInboundEmailProcessedForUser(
  db: Db,
  userId: string,
  id: string,
  processed: boolean,
): InboundEmailListItem | null {
  const { userEmail, contactEmails } = getUserEmailContext(db, userId);
  const rows = db
    .select()
    .from(inboundEmails)
    .where(eq(inboundEmails.id, id))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row || !inboundEmailBelongsToUser(row, userEmail, contactEmails)) {
    return null;
  }

  const timestamp = nowIso();
  db.update(inboundEmails)
    .set({ processed, updatedAt: timestamp })
    .where(eq(inboundEmails.id, id))
    .run();

  return toListItem(db, { ...row, processed, updatedAt: timestamp });
}
