import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { inboundEmails } from '../db/schema.js';
import { createId, nowIso } from './id.js';

export type PostmarkInboundPayload = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function extractEmail(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && 'Email' in value) {
    return asString((value as { Email?: unknown }).Email);
  }
  return '';
}

export function parsePostmarkReceivedAt(dateValue: unknown): string {
  if (typeof dateValue !== 'string' || dateValue.trim() === '') {
    return nowIso();
  }
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    return nowIso();
  }
  return parsed.toISOString();
}

export function extractPostmarkFields(payload: PostmarkInboundPayload) {
  const toFull = Array.isArray(payload.ToFull) ? payload.ToFull : [];
  const firstTo = toFull[0];

  return {
    subject: asString(payload.Subject),
    fromEmail:
      extractEmail(payload.FromFull) ||
      asString(payload.From),
    toEmail:
      asString(payload.OriginalRecipient) ||
      extractEmail(firstTo) ||
      asString(payload.To),
    receivedAt: parsePostmarkReceivedAt(payload.Date),
  };
}

export async function saveInboundEmail(
  db: Db,
  payload: PostmarkInboundPayload,
): Promise<string> {
  const id = createId();
  const timestamp = nowIso();
  const fields = extractPostmarkFields(payload);

  await db.insert(inboundEmails).values({
    id,
    provider: 'postmark',
    subject: fields.subject,
    fromEmail: fields.fromEmail,
    toEmail: fields.toEmail,
    receivedAt: fields.receivedAt,
    payload: JSON.stringify(payload),
    processed: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return id;
}

// Postmark retries a webhook when it doesn't get our response in time (e.g.
// a stalled or restarting machine) and keeps the same MessageID. Return the
// row already saved for it so a retry isn't stored and processed twice (#34).
export function findInboundEmailIdByMessageId(
  db: Db,
  messageId: unknown,
): string | null {
  if (typeof messageId !== 'string' || messageId.trim() === '') return null;
  const row = db
    .select({ id: inboundEmails.id })
    .from(inboundEmails)
    .where(sql`json_extract(${inboundEmails.payload}, '$.MessageID') = ${messageId}`)
    .limit(1)
    .all()[0];
  return row?.id ?? null;
}
