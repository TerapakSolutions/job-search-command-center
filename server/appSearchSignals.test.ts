/** @jest-environment node */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { createTestDb } from './lib/testDb.js';

// Search Console, 2026-11-09, sc-domain:terapak.com:
//  - "Duplicate without user-selected canonical": https://jobsearch.terapak.com/login.
//    Every route answers with the same shell, so /login looked like a copy of /.
//  - "Indexed, though blocked by robots.txt": https://jobsearch.terapak.com/auth/google.
//    Disallow: /auth/ kept Google from ever seeing the redirect, so the bare URL stayed indexed.
// The shell is identical everywhere, so the only per-URL signals are response HEADERS.
const SITE = 'https://jobsearch.terapak.com';
const PUBLIC_PATHS = ['/login', '/privacy'];

describe('search signals on the SPA shell and /auth', () => {
  const originalCwd = process.cwd();
  let tmp: string;
  let db: ReturnType<typeof createTestDb>;

  beforeAll(() => {
    db = createTestDb();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'search-signals-'));
    fs.mkdirSync(path.join(tmp, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'dist', 'index.html'), '<html>shell</html>');
    process.chdir(tmp);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function get(urlPath: string) {
    const server = http.createServer(createApp(db));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { redirect: 'manual' });
    await res.text();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return res;
  }

  it.each(PUBLIC_PATHS)('%s declares itself canonical and stays indexable', async (p) => {
    const res = await get(p);
    expect(res.status).toBe(200);
    expect(res.headers.get('link')).toBe(`<${SITE}${p}>; rel="canonical"`);
    expect(res.headers.get('x-robots-tag')).toBeNull();
  });

  it.each(['/', '/today', '/settings', '/no-such-page'])('%s (shell, not public) is noindex with no canonical', async (p) => {
    const res = await get(p);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('link')).toBeNull();
  });

  it('/auth/google is noindex on its redirect', async () => {
    const res = await get('/auth/google');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('/auth/google/callback is noindex too', async () => {
    const res = await get('/auth/google/callback');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });
});
