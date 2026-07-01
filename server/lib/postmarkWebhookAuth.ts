import type { NextFunction, Request, Response } from 'express';

function getExpectedCredentials(): { user: string; password: string } | null {
  const user = process.env.POSTMARK_WEBHOOK_USER;
  const password = process.env.POSTMARK_WEBHOOK_PASSWORD;
  if (!user || !password) {
    return null;
  }
  return { user, password };
}

export function postmarkWebhookAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = getExpectedCredentials();
  if (!expected) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Basic ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  const user = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded;
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

  if (user !== expected.user || password !== expected.password) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
