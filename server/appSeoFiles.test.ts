/** @jest-environment node */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { createTestDb } from './lib/testDb.js';

// robots.txt and sitemap.xml returned 404 in prod (2026-10-29): there was no
// public/ for Vite to copy into dist/, and the SPA fallback 404s any path with
// a file extension. These tests serve the REAL public/ files through the real
// app, so a missing file or a fallback that swallows them fails here.
const repoRoot = process.cwd();
const robots = fs.readFileSync(path.join(repoRoot, 'public', 'robots.txt'), 'utf8');
const sitemap = fs.readFileSync(path.join(repoRoot, 'public', 'sitemap.xml'), 'utf8');
const appTsx = fs.readFileSync(path.join(repoRoot, 'src', 'App.tsx'), 'utf8');

const SITE = 'https://jobsearch.terapak.com';
/** Reachable signed out and worth indexing (App.tsx: /login for signed-out users, /privacy before the auth check). */
const PUBLIC_PATHS = ['/login', '/privacy'];

describe('robots.txt and sitemap.xml are served, not swallowed by the SPA fallback', () => {
  let tmp: string;
  let db: ReturnType<typeof createTestDb>;

  beforeAll(() => {
    db = createTestDb();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-files-'));
    fs.mkdirSync(path.join(tmp, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'dist', 'index.html'), '<html>shell</html>');
    // What `vite build` does with public/: copy it verbatim into dist/.
    fs.copyFileSync(path.join(repoRoot, 'public', 'robots.txt'), path.join(tmp, 'dist', 'robots.txt'));
    fs.copyFileSync(path.join(repoRoot, 'public', 'sitemap.xml'), path.join(tmp, 'dist', 'sitemap.xml'));
    process.chdir(tmp);
  });

  afterAll(() => {
    process.chdir(repoRoot);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function get(urlPath: string) {
    const server = http.createServer(createApp(db));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { redirect: 'manual' });
    const body = await res.text();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return { res, body };
  }

  it('GET /robots.txt → 200 text/plain, the file itself, unauthenticated', async () => {
    const { res, body } = await get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(body).toBe(robots);
  });

  it('GET /sitemap.xml → 200 application/xml, the file itself, unauthenticated', async () => {
    const { res, body } = await get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/xml/);
    expect(body).toBe(sitemap);
  });
});

describe('robots.txt content', () => {
  const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)\s*$/gm)].map((m) => m[1]);

  it('references the sitemap by absolute URL', () => {
    expect(robots).toMatch(new RegExp(`^Sitemap: ${SITE}/sitemap\\.xml$`, 'm'));
  });

  it('disallows the API and the server-only prefixes', () => {
    for (const p of ['/api/', '/auth/', '/webhooks/']) expect(disallowed).toContain(p);
  });

  it('🔑 disallows EVERY signed-in route in App.tsx, so a new route cannot be indexed by default', () => {
    const shell = appTsx.slice(appTsx.indexOf('<AppShell>'), appTsx.indexOf('</AppShell>'));
    const routes = [...shell.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '/' && p !== '/login');
    expect(routes.length).toBeGreaterThan(5); // CONTROL: the slice really found the authenticated routes
    for (const r of routes) expect(disallowed).toContain(r);
  });

  it('does not disallow the public pages', () => {
    for (const p of PUBLIC_PATHS) {
      expect(disallowed.some((d) => p === d || p.startsWith(d.endsWith('/') ? d : `${d}/`))).toBe(false);
    }
  });
});

describe('sitemap.xml content', () => {
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  it('is a urlset in the sitemap namespace', () => {
    expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(sitemap.trim().endsWith('</urlset>')).toBe(true);
  });

  it('lists exactly the public pages, as absolute URLs on the site', () => {
    expect(locs.sort()).toEqual(PUBLIC_PATHS.map((p) => `${SITE}${p}`).sort());
  });
});
