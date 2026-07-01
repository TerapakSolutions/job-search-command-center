import { Router, type Request, type Response } from 'express';
import type { Db } from '../db/index.js';
import {
  getAutomationDashboardSummary,
  listAuditLogForUser,
  listPendingApprovalsForUser,
  resolvePendingApproval,
} from '../lib/emailAutomationService.js';

function parseLimit(value: unknown, defaultLimit = 20): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return defaultLimit;
  return Math.min(n, 100);
}

export function emailAutomationRouter(db: Db): Router {
  const router = Router();

  router.get('/dashboard', (req: Request, res: Response) => {
    const userId = req.userId!;
    const summary = getAutomationDashboardSummary(db, userId);
    res.json(summary);
  });

  router.get('/audit', (req: Request, res: Response) => {
    const userId = req.userId!;
    const entries = listAuditLogForUser(db, userId, {
      limit: parseLimit(req.query.limit),
    });
    res.json({ items: entries });
  });

  router.get('/pending-approvals', (req: Request, res: Response) => {
    const userId = req.userId!;
    const items = listPendingApprovalsForUser(db, userId);
    res.json({ items });
  });

  router.post('/pending-approvals/:id/approve', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const result = resolvePendingApproval(db, userId, id, 'approved');
    if (!result) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(result);
  });

  router.post('/pending-approvals/:id/reject', (req: Request, res: Response) => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const result = resolvePendingApproval(db, userId, id, 'rejected');
    if (!result) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(result);
  });

  return router;
}
