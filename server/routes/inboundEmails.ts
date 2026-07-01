import { Router, type Request, type Response } from 'express';
import type { Db } from '../db/index.js';
import {
  classifyInboundEmailForUser,
  classifyUnprocessedInboundEmailsForUser,
} from '../lib/emailClassificationService.js';
import {
  getInboundEmailDetailForUser,
  listInboundEmailsForUser,
  markInboundEmailProcessedForUser,
} from '../lib/inboundEmailService.js';

function parseLimit(value: unknown, defaultLimit = 50): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return defaultLimit;
  return Math.min(n, 100);
}

function parseOffset(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return 0;
  return n;
}

function parseProcessed(value: unknown): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function parseBatchLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return 20;
  return Math.min(n, 50);
}

export function inboundEmailsRouter(db: Db): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const userId = req.userId!;
    const result = listInboundEmailsForUser(db, userId, {
      limit: parseLimit(req.query.limit),
      offset: parseOffset(req.query.offset),
      processed: parseProcessed(req.query.processed),
      sender: typeof req.query.sender === 'string' ? req.query.sender : undefined,
      subject: typeof req.query.subject === 'string' ? req.query.subject : undefined,
      fromDate: typeof req.query.fromDate === 'string' ? req.query.fromDate : undefined,
      toDate: typeof req.query.toDate === 'string' ? req.query.toDate : undefined,
    });
    res.json(result);
  });

  router.post('/classify-unprocessed', async (req: Request, res: Response) => {
    const userId = req.userId!;
    try {
      const result = await classifyUnprocessedInboundEmailsForUser(db, userId, {
        limit: parseBatchLimit(req.body?.limit),
      });
      res.json(result);
    } catch (err) {
      console.error('[inbound-emails] batch classification failed', err);
      res.status(500).json({ error: 'Classification batch failed' });
    }
  });

  router.get('/:id', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const email = getInboundEmailDetailForUser(db, userId, id);
    if (!email) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(email);
  });

  router.post('/:id/classify', async (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const force = req.body?.force === true;

    try {
      const classification = await classifyInboundEmailForUser(db, userId, id, {
        force,
      });
      if (!classification) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      const email = getInboundEmailDetailForUser(db, userId, id);
      res.json({ classification, email });
    } catch (err) {
      console.error('[inbound-emails] classification failed', err);
      res.status(500).json({ error: 'Classification failed' });
    }
  });

  router.patch('/:id', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const processed = req.body?.processed;
    if (typeof processed !== 'boolean') {
      res.status(400).json({ error: 'processed must be a boolean' });
      return;
    }
    const updated = markInboundEmailProcessedForUser(db, userId, id, processed);
    if (!updated) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(updated);
  });

  return router;
}
