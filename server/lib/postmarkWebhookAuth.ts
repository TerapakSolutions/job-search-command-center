import type { NextFunction, Request, Response } from 'express';

function getExpectedCredentials(): { user: string; password: string } | null {
  const user = process.env.POSTMARK_WEBHOOK_USER;
  const password = process.env.POSTMARK_WEBHOOK_PASSWORD;
  if (!user || !password) {
    return null;
  }
  return { user, password };
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function postmarkWebhookAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = getExpectedCredentials();
  if (!expected) {
    // No credentials configured. Behaviour is deliberately environment-aware
    // (prod-vs-dev is distinguished by NODE_ENV, the same signal used by the
    // session cookie and DB path).
    if (isProduction()) {
      // Fail CLOSED: a production deployment with unset webhook credentials must
      // refuse inbound traffic, never accept it unauthenticated. Reject before
      // any persistence and log loudly so a deploy-time misconfiguration is
      // visible rather than a silent open door.
      console.error(
        '[postmark/inbound] REFUSING inbound webhook: POSTMARK_WEBHOOK_USER and ' +
          'POSTMARK_WEBHOOK_PASSWORD are not set in production. Failing closed — ' +
          'all inbound webhook requests are rejected until these are configured.',
      );
      res
        .status(503)
        .json({ error: 'Webhook authentication is not configured' });
      return;
    }
    // Non-production: deliberate opt-out so local development needs no real
    // Postmark credentials. This branch never runs in production (guarded above).
    console.warn(
      '[postmark/inbound] webhook authentication is DISABLED because ' +
        'POSTMARK_WEBHOOK_USER/POSTMARK_WEBHOOK_PASSWORD are unset (non-production). ' +
        'Do not run production without these configured.',
    );
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
