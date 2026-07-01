import { Router, type Request, type Response } from 'express';
import type { Db } from '../db/index.js';
import {
  analyzeEmailAutomation,
  createApplicationFromEmail,
  createContactFromEmail,
  draftReplyFromEmail,
  listAuditLogForInboundEmail,
  runEmailAutomation,
  updatePipelineFromEmail,
} from '../lib/emailAutomationService.js';
import {
  classifyInboundEmailForUser,
  classifyUnprocessedInboundEmailsForUser,
} from '../lib/emailClassificationService.js';
import {
  getInboundEmailDetailForUser,
  listInboundEmailsForUser,
  markInboundEmailProcessedForUser,
  softDeleteInboundEmailForUser,
} from '../lib/inboundEmailService.js';
import { processInboundEmail } from '../lib/inboundEmailProcessingService.js';

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

  router.post('/:id/reanalyze', async (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const email = getInboundEmailDetailForUser(db, userId, id);
    if (!email) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    try {
      const result = await processInboundEmail(db, id, {
        userId,
        reanalysis: true,
        manual: true,
      });
      const updated = getInboundEmailDetailForUser(db, userId, id);
      res.json({ result, email: updated });
    } catch (err) {
      console.error('[inbound-emails] reanalysis failed', err);
      res.status(500).json({ error: 'Re-analysis failed' });
    }
  });

  router.post('/:id/retry-processing', async (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const email = getInboundEmailDetailForUser(db, userId, id);
    if (!email) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    try {
      const result = await processInboundEmail(db, id, {
        userId,
        reanalysis: email.processingStatus === 'processed',
        manual: true,
      });
      const updated = getInboundEmailDetailForUser(db, userId, id);
      res.json({ result, email: updated });
    } catch (err) {
      console.error('[inbound-emails] retry processing failed', err);
      res.status(500).json({ error: 'Retry processing failed' });
    }
  });

  router.get('/:id/audit', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const email = getInboundEmailDetailForUser(db, userId, id);
    if (!email) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const items = listAuditLogForInboundEmail(db, userId, id, {
      limit: parseLimit(req.query.limit, 50),
    });
    res.json({ items });
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

  router.delete('/:id', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const deleted = softDeleteInboundEmailForUser(db, userId, id);
    if (!deleted) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.status(204).send();
  });

  router.get('/:id/automation', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const analysis = analyzeEmailAutomation(db, userId, id);
    if (!analysis) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(analysis);
  });

  router.post('/:id/automation/create-application', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const result = createApplicationFromEmail(db, userId, id);
    if (!result) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.status(result.success ? 201 : 409).json(result);
  });

  router.post('/:id/automation/create-contact', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const applicationId = req.body?.applicationId;
    if (typeof applicationId !== 'string' || !applicationId) {
      res.status(400).json({ error: 'applicationId is required' });
      return;
    }
    const result = createContactFromEmail(db, userId, id, applicationId);
    if (!result) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(result);
  });

  router.post('/:id/automation/update-pipeline', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const applicationId = req.body?.applicationId;
    if (typeof applicationId !== 'string' || !applicationId) {
      res.status(400).json({ error: 'applicationId is required' });
      return;
    }
    const result = updatePipelineFromEmail(db, userId, id, {
      applicationId,
      status: typeof req.body?.status === 'string' ? req.body.status : undefined,
      force: req.body?.force === true,
    });
    if (!result) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(result);
  });

  router.post('/:id/automation/draft-reply', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const result = draftReplyFromEmail(db, userId, id);
    if (!result) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(result);
  });

  router.post('/:id/automation/run', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const result = runEmailAutomation(db, userId, id, {
      applicationId:
        typeof req.body?.applicationId === 'string'
          ? req.body.applicationId
          : undefined,
      force: req.body?.force === true,
    });
    if (!result) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(result);
  });

  return router;
}
