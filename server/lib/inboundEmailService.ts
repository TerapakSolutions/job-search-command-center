import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { contacts, inboundEmails, users } from '../db/schema.js';
import { nowIso } from './id.js';

export interface InboundEmailListItem {
  id: string;
  subject: string;
  fromEmail: string;
  toEmail: string;
  receivedAt: string;
  processed: boolean;
}

export interface InboundEmailDetail extends InboundEmailListItem {
  provider: string;
  textBody: string;
  htmlBody: string | null;
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

function getUserEmailContext(db: Db, userId: string) {
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

function toListItem(row: typeof inboundEmails.$inferSelect): InboundEmailListItem {
  return {
    id: row.id,
    subject: row.subject,
    fromEmail: row.fromEmail,
    toEmail: row.toEmail,
    receivedAt: row.receivedAt,
    processed: row.processed,
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
  const items = matched.slice(offset, offset + limit).map(toListItem);

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
    ...toListItem(row),
    provider: row.provider,
    textBody,
    htmlBody,
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

  return toListItem({ ...row, processed, updatedAt: timestamp });
}
