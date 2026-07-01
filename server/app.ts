import path from 'node:path';
import express from 'express';
import cors from 'cors';
import type { Db } from './db/index.js';
import { getDbPath } from './db/index.js';
import { requireAuth } from './lib/authMiddleware.js';
import { authRouter } from './routes/auth.js';
import { postmarkInboundRouter } from './routes/postmarkInbound.js';
import {
  applicationsRouter,
  contactsRouter,
  communicationsRouter,
  followUpTasksRouter,
  interviewsRouter,
  documentsRouter,
} from './routes/index.js';

export function createApp(db: Db) {
  const app = express();

  const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
    }),
  );
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, dbPath: getDbPath() });
  });

  app.use('/auth', authRouter(db));
  app.use('/webhooks/postmark', postmarkInboundRouter(db));

  app.use('/api', requireAuth);
  app.use('/api/applications', applicationsRouter(db));
  app.use('/api/contacts', contactsRouter(db));
  app.use('/api/communications', communicationsRouter(db));
  app.use('/api/follow-up-tasks', followUpTasksRouter(db));
  app.use('/api/interviews', interviewsRouter(db));
  app.use('/api/documents', documentsRouter(db));

  const distPath = path.join(process.cwd(), 'dist');

  app.use(express.static(distPath, { index: false }));
  app.use((req, res, next) => {
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/auth') ||
      req.path.startsWith('/webhooks') ||
      req.method !== 'GET'
    ) {
      next();
      return;
    }
    if (req.path.startsWith('/assets/')) {
      res.status(404).end();
      return;
    }
    if (/\.[a-zA-Z0-9]+$/.test(req.path)) {
      res.status(404).end();
      return;
    }
    res.sendFile(path.join(distPath, 'index.html'), (err) => {
      if (err) next();
    });
  });

  return app;
}
