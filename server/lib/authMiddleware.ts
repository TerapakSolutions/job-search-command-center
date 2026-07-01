import type { Request, Response, NextFunction } from 'express';
import { getUserIdFromRequest } from './session.js';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.userId = userId;
  next();
}
