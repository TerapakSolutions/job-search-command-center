import { Router, type Request, type Response } from 'express';
import type { Db } from '../db/index.js';
import {
  getActivityHistory,
  getActivityMetrics,
  getJobSearchGoals,
  getProductivityInsights,
  updateJobSearchGoals,
} from '../lib/activityMetrics.js';

function parseDays(value: unknown, defaultDays = 90): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return defaultDays;
  return Math.min(n, 365);
}

export function jobSearchGoalsRouter(db: Db): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const userId = req.userId!;
    res.json(getJobSearchGoals(db, userId));
  });

  router.put('/', (req: Request, res: Response) => {
    const userId = req.userId!;
    const updated = updateJobSearchGoals(db, userId, {
      dailyGoal: req.body?.dailyGoal,
      weeklyGoal: req.body?.weeklyGoal,
      monthlyGoal: req.body?.monthlyGoal,
    });
    res.json(updated);
  });

  return router;
}

export function activityRouter(db: Db): Router {
  const router = Router();

  router.get('/metrics', (req: Request, res: Response) => {
    const userId = req.userId!;
    res.json(getActivityMetrics(db, userId));
  });

  router.get('/history', (req: Request, res: Response) => {
    const userId = req.userId!;
    const days = parseDays(req.query.days);
    res.json(getActivityHistory(db, userId, days));
  });

  router.get('/insights', (req: Request, res: Response) => {
    const userId = req.userId!;
    res.json(getProductivityInsights(db, userId));
  });

  return router;
}
