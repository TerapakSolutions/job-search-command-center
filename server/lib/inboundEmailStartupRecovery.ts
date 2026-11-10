import { and, eq, gte, isNull } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { inboundEmails } from '../db/schema.js';
import {
  scheduleInboundEmailProcessing,
  type ProcessingOptions,
} from './inboundEmailProcessingQueue.js';

const DEFAULT_WINDOW_HOURS = 24;

// Processing runs in-process (setImmediate), so a deploy or restart can leave
// an email unprocessed, or stuck in "processing", with nothing to pick it up.
// Postmark will not retry it: we answered 200 once the row was saved. At
// startup, reschedule such emails from the last day. Older rows are left
// alone so a deploy never sweeps up stale or test emails.
//
// Assumes one app machine: at startup nothing in this process is processing,
// so a "processing" row is an orphan. With several machines, each would
// reschedule the same rows.
export function recoverInterruptedInboundEmails(
  db: Db,
  options: {
    now?: Date;
    windowHours?: number;
    schedule?: (db: Db, emailId: string, options?: ProcessingOptions) => void;
  } = {},
): string[] {
  const now = options.now ?? new Date();
  const since = new Date(
    now.getTime() - (options.windowHours ?? DEFAULT_WINDOW_HOURS) * 60 * 60 * 1000,
  ).toISOString();
  const schedule = options.schedule ?? scheduleInboundEmailProcessing;

  const unprocessed = db
    .select({ id: inboundEmails.id })
    .from(inboundEmails)
    .where(
      and(
        eq(inboundEmails.processingStatus, 'unprocessed'),
        isNull(inboundEmails.deletedAt),
        gte(inboundEmails.receivedAt, since),
      ),
    )
    .all();

  const stuck = db
    .select({ id: inboundEmails.id })
    .from(inboundEmails)
    .where(
      and(
        eq(inboundEmails.processingStatus, 'processing'),
        isNull(inboundEmails.deletedAt),
        gte(inboundEmails.processingStartedAt, since),
      ),
    )
    .all();

  // Nothing has started on an unprocessed row: a plain run. A row stuck in
  // "processing" may have finished some actions before the restart, so it
  // re-runs through the reanalysis path, which gets past the "processing"
  // guard and skips completed actions. Recovery writes no status itself.
  for (const { id } of unprocessed) schedule(db, id, undefined);
  for (const { id } of stuck) schedule(db, id, { reanalysis: true });
  const ids = [...unprocessed, ...stuck].map((row) => row.id);
  return ids;
}
