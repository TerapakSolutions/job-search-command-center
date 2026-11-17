import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { users } from '../db/schema.js';

/**
 * Per-user settings. Mounted behind requireAuth: every read and write is scoped
 * to the session's user id; anything identifying in the body is ignored.
 *
 * Must match FOLLOW_UP_AFTER_DAYS / _MIN / _MAX in src/lib/nextActionDates.ts
 * (the server does not import from src/).
 */
export const DEFAULT_FOLLOW_UP_AFTER_DAYS = 3;
export const MIN_FOLLOW_UP_AFTER_DAYS = 1;
export const MAX_FOLLOW_UP_AFTER_DAYS = 14;

function isValidFollowUpAfterDays(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_FOLLOW_UP_AFTER_DAYS &&
    value <= MAX_FOLLOW_UP_AFTER_DAYS
  );
}

function readFollowUpAfterDays(db: Db, userId: string): number {
  const row = db
    .select({ followUpAfterDays: users.followUpAfterDays })
    .from(users)
    .where(eq(users.id, userId))
    .all()[0];
  return row?.followUpAfterDays ?? DEFAULT_FOLLOW_UP_AFTER_DAYS;
}

function userExists(db: Db, userId: string): boolean {
  return db.select({ id: users.id }).from(users).where(eq(users.id, userId)).all().length > 0;
}

export function userSettingsRouter(db: Db): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    if (!userExists(db, req.userId!)) {
      // A valid session for a deleted user: match the PUT, don't invent a default.
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json({ followUpAfterDays: readFollowUpAfterDays(db, req.userId!) });
  });

  router.put('/', (req: Request, res: Response) => {
    const value: unknown = req.body?.followUpAfterDays;
    if (!isValidFollowUpAfterDays(value)) {
      res.status(422).json({
        error: `Follow-up days must be a whole number from ${MIN_FOLLOW_UP_AFTER_DAYS} to ${MAX_FOLLOW_UP_AFTER_DAYS}.`,
      });
      return;
    }
    const userId = req.userId!;
    const result = db
      .update(users)
      .set({ followUpAfterDays: value, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId))
      .run();
    if (result.changes === 0) {
      // A valid session for a deleted user: nothing was saved, so don't say it was.
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json({ followUpAfterDays: readFollowUpAfterDays(db, userId) });
  });

  return router;
}
