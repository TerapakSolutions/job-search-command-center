import { Router, type Request, type Response } from 'express';
import type { Db } from '../db/index.js';
import {
  generateDailyBriefingForUser,
  generateDailyBriefingsForAllUsers,
  getBriefingById,
  getLatestBriefing,
  listBriefings,
} from '../lib/briefingGenerator.js';

function parseLimit(value: unknown, defaultLimit = 30): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return defaultLimit;
  return Math.min(n, 100);
}

export function dailyBriefingsRouter(db: Db): Router {
  const router = Router();

  router.get('/latest', (req: Request, res: Response) => {
    const userId = req.userId!;
    const briefing = getLatestBriefing(db, userId);
    if (!briefing) {
      res.status(404).json({ error: 'No briefing found' });
      return;
    }
    res.json(briefing);
  });

  router.get('/', (req: Request, res: Response) => {
    const userId = req.userId!;
    const limit = parseLimit(req.query.limit);
    res.json(listBriefings(db, userId, limit));
  });

  router.get('/:id', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const briefing = getBriefingById(db, userId, id);
    if (!briefing) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(briefing);
  });

  router.post('/generate', async (req: Request, res: Response) => {
    const userId = req.userId!;
    const force = Boolean(req.body?.force);
    try {
      const briefing = await generateDailyBriefingForUser(db, userId, new Date(), {
        force,
        sendEmail: Boolean(req.body?.sendEmail),
      });
      if (!briefing) {
        res.status(500).json({ error: 'Generation failed' });
        return;
      }
      res.status(force ? 200 : 201).json(briefing);
    } catch (err) {
      console.error('[daily-briefings] Manual generation failed', err);
      res.status(500).json({ error: 'Generation failed' });
    }
  });

  return router;
}

function verifyCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.authorization;
  if (auth === `Bearer ${secret}`) return true;
  const header = req.headers['x-cron-secret'];
  return header === secret;
}

export function dailyBriefingsCronRouter(db: Db): Router {
  const router = Router();

  router.post('/daily-briefings', async (req: Request, res: Response) => {
    if (!verifyCronSecret(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const result = await generateDailyBriefingsForAllUsers(db);
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[cron/daily-briefings] Job failed', err);
      res.status(500).json({ error: 'Job failed' });
    }
  });

  return router;
}
