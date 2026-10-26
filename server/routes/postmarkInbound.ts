import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { inboundEmails } from '../db/schema.js';
import {
  findInboundEmailIdByMessageId,
  saveInboundEmail,
  type PostmarkInboundPayload,
} from '../lib/postmarkInbound.js';
import { scheduleInboundEmailProcessing } from '../lib/inboundEmailProcessingQueue.js';
import { splitForwardBundle } from '../lib/forwardBundleSplitter.js';
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
        const parts = splitForwardBundle(payload);
        if (parts.length === 1) {
          const existingId = findInboundEmailIdByMessageId(db, payload.MessageID);
          if (existingId) {
            console.log('[postmark/inbound] duplicate delivery ignored', {
              messageId: payload.MessageID,
            });
            res.status(200).json({ ok: true, id: existingId, duplicate: true });
            return;
          }
          const id = await saveInboundEmail(db, payload);
          scheduleInboundEmailProcessing(db, id);
          res.status(200).json({ ok: true, id });
          return;
        }

        console.log('[postmark/inbound] split bundle into', parts.length, {
          messageId: payload.MessageID,
        });
        const ids: string[] = [];
        // Schedule each part as soon as it is saved, so a later save failure
        // never leaves earlier parts stored but unprocessed.
        for (const part of parts) {
          const existingId = findInboundEmailIdByMessageId(db, part.MessageID);
          if (existingId) {
            ids.push(existingId);
            continue;
          }
          const id = await saveInboundEmail(db, part);
          scheduleInboundEmailProcessing(db, id);
          ids.push(id);
        }
        res.status(200).json({ ok: true, ids });
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
