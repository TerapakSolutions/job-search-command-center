import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { inboundEmails } from '../db/schema.js';
import {
  saveInboundEmail,
  type PostmarkInboundPayload,
} from '../lib/postmarkInbound.js';
import { scheduleInboundEmailProcessing } from '../lib/inboundEmailProcessingQueue.js';
import { postmarkWebhookAuth } from '../lib/postmarkWebhookAuth.js';

export function postmarkInboundRouter(db: Db): Router {
  const router = Router();

  router.post(
    '/inbound',
    postmarkWebhookAuth,
    async (req: Request, res: Response) => {
      const payload = (req.body ?? {}) as PostmarkInboundPayload;

      console.log('[postmark/inbound] received webhook', {
        messageId: payload.MessageID,
        subject: payload.Subject,
        from: payload.From,
        to: payload.To,
      });

      try {
        const id = await saveInboundEmail(db, payload);
        scheduleInboundEmailProcessing(db, id);
        res.status(200).json({ ok: true, id });
      } catch (err) {
        console.error('[postmark/inbound] failed to save inbound email', err);
        res.status(200).json({ ok: true, saved: false });
      }
    },
  );

  return router;
}

export async function getInboundEmailById(db: Db, id: string) {
  const rows = await db
    .select()
    .from(inboundEmails)
    .where(eq(inboundEmails.id, id))
    .limit(1);
  return rows[0] ?? null;
}
