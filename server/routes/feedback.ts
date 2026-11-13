import { eq } from 'drizzle-orm';
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Db } from '../db/index.js';
import { feedback, users } from '../db/schema.js';
import {
  sendFeedbackEmail,
  sendFeedbackSlack,
  type FeedbackReport,
  type NotifyResult,
} from '../lib/feedbackNotify.js';
import { createId, nowIso } from '../lib/id.js';

const MESSAGE_MAX = 4000;
const PAGE_URL_MAX = 500;
const APP_VERSION_MAX = 100;
const USER_AGENT_MAX = 500;
const ERROR_MAX = 500;
const ALLOWED_FIELDS = new Set(['message', 'pageUrl', 'appVersion']);

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/** Ships dark: anything but the exact string 'true' keeps the route unmounted-looking. */
export function isFeedbackEnabled(): boolean {
  return process.env.FEEDBACK_ENABLED === 'true';
}

interface ValidBody {
  message: string;
  pageUrl: string | null;
  appVersion: string | null;
}

function validate(body: unknown): ValidBody | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Body must be a JSON object.';
  const record = body as Record<string, unknown>;
  const unknownField = Object.keys(record).find((k) => !ALLOWED_FIELDS.has(k));
  if (unknownField) return `Unknown field: ${unknownField}`;

  if (typeof record.message !== 'string') return 'message is required.';
  const message = record.message.trim();
  if (message.length < 1 || message.length > MESSAGE_MAX) {
    return `message must be 1–${MESSAGE_MAX} characters.`;
  }

  let pageUrl: string | null = null;
  if (record.pageUrl !== undefined && record.pageUrl !== null) {
    if (typeof record.pageUrl !== 'string' || record.pageUrl.length > PAGE_URL_MAX) {
      return `pageUrl must be a string of at most ${PAGE_URL_MAX} characters.`;
    }
    pageUrl = record.pageUrl;
  }

  let appVersion: string | null = null;
  if (record.appVersion !== undefined && record.appVersion !== null) {
    if (typeof record.appVersion !== 'string' || record.appVersion.length > APP_VERSION_MAX) {
      return `appVersion must be a string of at most ${APP_VERSION_MAX} characters.`;
    }
    appVersion = record.appVersion;
  }

  return { message, pageUrl, appVersion };
}

function errorText(reason: unknown): string {
  const text = reason instanceof Error ? reason.message : String(reason);
  return text.slice(0, ERROR_MAX);
}

export function feedbackRouter(db: Db): Router {
  const router = Router();

  // In-memory, per-process limiter: fine for the single Fly machine this app runs
  // on. It resets on restart and would not be shared if we ever scaled out.
  // Created per router (not per module) so each app instance has its own budget.
  const recentByUser = new Map<string, number[]>();

  function overLimit(userId: string, now: number): boolean {
    const recent = (recentByUser.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
      recentByUser.set(userId, recent);
      return true;
    }
    recent.push(now);
    recentByUser.set(userId, recent);
    return false;
  }

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    // Flag off: fall through to the default 404, same as an unmounted route.
    if (!isFeedbackEnabled()) {
      next();
      return;
    }

    // Identity comes ONLY from the session (requireAuth set req.userId).
    const userId = req.userId;
    const user = userId ? db.select().from(users).where(eq(users.id, userId)).all()[0] : undefined;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const parsed = validate(req.body);
    if (typeof parsed === 'string') {
      res.status(400).json({ error: parsed });
      return;
    }

    if (overLimit(user.id, Date.now())) {
      res.status(429).json({ error: 'Too many reports. Please try again later.' });
      return;
    }

    const userAgentHeader = req.get('user-agent');
    const id = createId();
    const createdAt = nowIso();
    db.insert(feedback)
      .values({
        id,
        userId: user.id,
        userEmail: user.email,
        message: parsed.message,
        pageUrl: parsed.pageUrl,
        userAgent: userAgentHeader ? userAgentHeader.slice(0, USER_AGENT_MAX) : null,
        appVersion: parsed.appVersion,
        createdAt,
      })
      .run();

    // The report is saved; nothing below may fail the request.
    const report: FeedbackReport = {
      userEmail: user.email,
      message: parsed.message,
      pageUrl: parsed.pageUrl,
      createdAt,
    };
    try {
      // Awaited (each notifier has its own timeout) so the row holds the outcome
      // by the time the user sees "Thanks".
      const [slack, email] = await Promise.allSettled([
        sendFeedbackSlack(report),
        sendFeedbackEmail(report),
      ]);
      const doneAt = nowIso();
      const outcome = (r: PromiseSettledResult<NotifyResult>) =>
        r.status === 'fulfilled'
          ? { at: r.value === 'sent' ? doneAt : null, error: null }
          : { at: null, error: errorText(r.reason) };
      const s = outcome(slack);
      const e = outcome(email);
      db.update(feedback)
        .set({
          slackNotifiedAt: s.at,
          slackError: s.error,
          emailNotifiedAt: e.at,
          emailError: e.error,
        })
        .where(eq(feedback.id, id))
        .run();
      if (s.error) console.warn(`[feedback] Slack notify failed for ${id}: ${s.error}`);
      if (e.error) console.warn(`[feedback] email notify failed for ${id}: ${e.error}`);
    } catch (err) {
      console.error(`[feedback] recording notifier results failed for ${id}:`, err);
    }

    res.status(201).json({ id });
  });

  return router;
}
