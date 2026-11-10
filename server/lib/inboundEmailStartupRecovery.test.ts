/** @jest-environment node */
import { eq } from 'drizzle-orm';
import { inboundEmails } from '../db/schema.js';
import { recoverInterruptedInboundEmails } from './inboundEmailStartupRecovery.js';
import { createTestDb, seedInboundEmail } from './testDb.js';

const NOW = new Date('2026-11-10T18:00:00.000Z');

function seed(
  db: ReturnType<typeof createTestDb>,
  id: string,
  receivedAt: string,
  state: { processingStatus?: string; processingStartedAt?: string | null; deletedAt?: string | null } = {},
) {
  seedInboundEmail(db, { id, receivedAt });
  db.update(inboundEmails)
    .set({
      processingStatus: state.processingStatus ?? 'unprocessed',
      processingStartedAt: state.processingStartedAt ?? null,
      deletedAt: state.deletedAt ?? null,
    })
    .where(eq(inboundEmails.id, id))
    .run();
}

function statusOf(db: ReturnType<typeof createTestDb>, id: string) {
  return db.select().from(inboundEmails).where(eq(inboundEmails.id, id)).all()[0].processingStatus;
}

describe('recovering emails interrupted by a restart', () => {
  it('reprocesses recent unprocessed emails, and recent ones stuck in processing', () => {
    const db = createTestDb();
    seed(db, 'recent-unprocessed', '2026-11-10T17:59:30.000Z');
    seed(db, 'recent-stuck', '2026-11-10T17:00:00.000Z', {
      processingStatus: 'processing',
      processingStartedAt: '2026-11-10T17:00:05.000Z',
    });
    const schedule = jest.fn();

    const recovered = recoverInterruptedInboundEmails(db, { now: NOW, schedule });

    expect(recovered.sort()).toEqual(['recent-stuck', 'recent-unprocessed']);
    // Nothing has started on an unprocessed row: a plain run.
    expect(schedule).toHaveBeenCalledWith(db, 'recent-unprocessed', undefined);
    // A stuck row may have finished some actions before the restart: re-run
    // it through the reanalysis path, which skips completed actions. Its
    // status is not written by recovery.
    expect(schedule).toHaveBeenCalledWith(db, 'recent-stuck', { reanalysis: true });
    expect(statusOf(db, 'recent-stuck')).toBe('processing');
  });

  it('leaves old, deleted and finished emails alone', () => {
    const db = createTestDb();
    seed(db, 'old-unprocessed', '2026-07-01T21:34:04.819Z');
    seed(db, 'old-stuck', '2026-11-01T10:00:00.000Z', {
      processingStatus: 'processing',
      processingStartedAt: '2026-11-01T10:00:05.000Z',
    });
    seed(db, 'deleted-recent', '2026-11-10T17:30:00.000Z', { deletedAt: '2026-11-10T17:31:00.000Z' });
    seed(db, 'processed-recent', '2026-11-10T17:30:00.000Z', { processingStatus: 'processed' });
    seed(db, 'failed-recent', '2026-11-10T17:30:00.000Z', { processingStatus: 'failed' });
    const schedule = jest.fn();

    expect(recoverInterruptedInboundEmails(db, { now: NOW, schedule })).toEqual([]);
    expect(schedule).not.toHaveBeenCalled();
    expect(statusOf(db, 'old-stuck')).toBe('processing');
  });
});
