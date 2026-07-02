/**
 * Read-only diagnostic: list inbound emails that may hold stale classification
 * or missing interview data because they were processed BEFORE the
 * interview-confirmation classification fix and were never reprocessed.
 *
 * Background: an already-`processed` inbound email is skipped on re-entry
 * (see processInboundEmail) and there is no automatic backfill, so an email
 * classified under older logic keeps its old result until someone reanalyzes it
 * manually via `POST /api/inbound-emails/:id/reanalyze`.
 *
 * This script ONLY lists candidates. It deliberately does NOT reanalyze
 * anything: re-running classification has LLM cost/latency and can alter data
 * that was reviewed/approved (including emails correctly classified as "Other"
 * under the old logic). Reanalysis stays a manual, per-email decision.
 *
 * Usage:
 *   pnpm find:stale-classifications
 *   DATABASE_PATH=/data/jobsearch.sqlite pnpm find:stale-classifications
 *   STALE_CUTOFF_ISO=2026-07-02T19:36:00Z pnpm find:stale-classifications
 */
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { createDb, getDbPath } from '../db/index.js';
import { inboundEmails } from '../db/schema.js';

// The interview-automation fix (interview-record creation) merged to main at
// this time. Emails last processed before it may be misclassified. Overridable
// via STALE_CUTOFF_ISO for reuse against a different fix boundary.
const DEFAULT_CUTOFF_ISO = '2026-07-02T19:36:00.000Z';

function resolveCutoff(): string {
  const raw = process.env.STALE_CUTOFF_ISO?.trim();
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    console.warn(`[find-stale] Ignoring invalid STALE_CUTOFF_ISO="${raw}"`);
  }
  return DEFAULT_CUTOFF_ISO;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function main(): void {
  const cutoff = resolveCutoff();
  const db = createDb();

  // A row is a candidate if it was actually processed before the cutoff and its
  // stored result looks un-fixed: classified "Other"/unclassified, or with no
  // interview detected. `last_processed_at` falls back to `processed_at`.
  const processedAt = sql`COALESCE(${inboundEmails.lastProcessedAt}, ${inboundEmails.processedAt})`;

  const rows = db
    .select({
      id: inboundEmails.id,
      subject: inboundEmails.subject,
      fromEmail: inboundEmails.fromEmail,
      receivedAt: inboundEmails.receivedAt,
      classification: inboundEmails.classification,
      confidence: inboundEmails.classificationConfidence,
      interviewDetected: inboundEmails.interviewDetected,
      processingStatus: inboundEmails.processingStatus,
      lastProcessedAt: inboundEmails.lastProcessedAt,
      processedAt: inboundEmails.processedAt,
    })
    .from(inboundEmails)
    .where(
      and(
        isNull(inboundEmails.deletedAt),
        sql`${processedAt} IS NOT NULL`,
        sql`${processedAt} < ${cutoff}`,
        or(
          eq(inboundEmails.classification, 'Other'),
          isNull(inboundEmails.classification),
          eq(inboundEmails.interviewDetected, false),
          isNull(inboundEmails.interviewDetected),
        ),
      ),
    )
    .orderBy(desc(inboundEmails.receivedAt))
    .all();

  console.log('== Stale-classification candidate scan (READ ONLY) ==');
  console.log(`Database:        ${getDbPath()}`);
  console.log(`Cutoff (< this): ${cutoff}`);
  console.log(
    'Filter:          not deleted, last processed before cutoff, AND ' +
      '(classification = "Other"/unset OR interview_detected = 0/unset)',
  );
  console.log('');

  if (rows.length === 0) {
    console.log('No candidate emails found. Nothing to review.');
    return;
  }

  // Strongest signal (an actual mis-bucket like the reported Pathstream email)
  // vs. the broader "no interview detected" set — surfaced so review can focus.
  const strong = rows.filter(
    (r) => r.classification === 'Other' || r.classification === null,
  );

  for (const r of rows) {
    const when = r.lastProcessedAt ?? r.processedAt ?? '(unknown)';
    console.log(
      [
        r.id,
        `recv=${r.receivedAt}`,
        `proc=${when}`,
        `class=${r.classification ?? 'null'}`,
        `conf=${r.confidence ?? 'null'}`,
        `interview=${r.interviewDetected ? 'yes' : 'no'}`,
        `from=${truncate(r.fromEmail, 32)}`,
        `subj="${truncate(r.subject, 60)}"`,
      ].join('  '),
    );
  }

  console.log('');
  console.log(
    `${rows.length} candidate(s) — ${strong.length} with classification ` +
      '"Other"/unset (strongest signal).',
  );
  console.log('');
  console.log('NEXT STEP (manual, per email — this script changes nothing):');
  console.log('  Review each candidate, then reanalyze the ones that look wrong:');
  console.log('  POST /api/inbound-emails/<id>/reanalyze');
  console.log(
    '  Do NOT bulk-reanalyze blindly: reruns cost LLM calls and can change ' +
      'data for emails that were correctly "Other" under the old logic.',
  );
}

main();
