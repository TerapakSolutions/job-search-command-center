import { eq, or } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import type { Db } from '../db/index.js';
import { users } from '../db/schema.js';
import { createId, nowIso } from '../lib/id.js';
import {
  clearSessionCookie,
  getUserIdFromRequest,
  setSessionCookie,
} from '../lib/session.js';

function getAppBaseUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:3001';
}

function getFrontendUrl(): string {
  return process.env.FRONTEND_URL ?? 'http://localhost:5173';
}

function getGoogleConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required');
  }
  return { clientId, clientSecret };
}

function publicUser(row: typeof users.$inferSelect) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
  };
}

export function authRouter(db: Db): Router {
  const router = Router();

  router.get('/google', (_req: Request, res: Response) => {
    try {
      const { clientId } = getGoogleConfig();
      const redirectUri = `${getAppBaseUrl()}/auth/google/callback`;
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        access_type: 'online',
        prompt: 'select_account',
      });
      res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Auth configuration error',
      });
    }
  });

  router.get('/google/callback', async (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    if (!code) {
      res.redirect(`${getFrontendUrl()}/login?error=missing_code`);
      return;
    }

    try {
      const { clientId, clientSecret } = getGoogleConfig();
      const redirectUri = `${getAppBaseUrl()}/auth/google/callback`;

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        res.redirect(`${getFrontendUrl()}/login?error=token_exchange_failed`);
        return;
      }

      const tokens = (await tokenRes.json()) as { access_token?: string };
      if (!tokens.access_token) {
        res.redirect(`${getFrontendUrl()}/login?error=missing_access_token`);
        return;
      }

      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!profileRes.ok) {
        res.redirect(`${getFrontendUrl()}/login?error=profile_fetch_failed`);
        return;
      }

      const profile = (await profileRes.json()) as {
        id?: string;
        email?: string;
        name?: string;
        picture?: string;
      };

      if (!profile.id || !profile.email) {
        res.redirect(`${getFrontendUrl()}/login?error=invalid_profile`);
        return;
      }

      const existing = db
        .select()
        .from(users)
        .where(
          or(eq(users.googleId, profile.id), eq(users.email, profile.email)),
        )
        .all();

      let user = existing[0];
      const timestamp = nowIso();

      if (user) {
        if (
          user.googleId !== profile.id ||
          user.name !== (profile.name ?? user.name) ||
          user.avatarUrl !== (profile.picture ?? null)
        ) {
          db.update(users)
            .set({
              googleId: profile.id,
              name: profile.name ?? user.name,
              avatarUrl: profile.picture ?? null,
              updatedAt: timestamp,
            })
            .where(eq(users.id, user.id))
            .run();
          user = db.select().from(users).where(eq(users.id, user.id)).all()[0];
        }
      } else {
        const id = createId();
        db.insert(users)
          .values({
            id,
            googleId: profile.id,
            email: profile.email,
            name: profile.name ?? profile.email,
            avatarUrl: profile.picture ?? null,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .run();
        user = db.select().from(users).where(eq(users.id, id)).all()[0];
      }

      setSessionCookie(res, user.id);
      res.redirect(`${getFrontendUrl()}/today`);
    } catch {
      res.redirect(`${getFrontendUrl()}/login?error=auth_failed`);
    }
  });

  router.get('/me', (req: Request, res: Response) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const rows = db.select().from(users).where(eq(users.id, userId)).all();
    if (rows.length === 0) {
      clearSessionCookie(res);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    res.json(publicUser(rows[0]));
  });

  router.post('/logout', (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.status(204).send();
  });

  return router;
}
