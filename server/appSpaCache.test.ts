/** @jest-environment node */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { createTestDb } from './lib/testDb.js';

// The SPA shell must not be cached: it names the hashed bundle, so a cached
// copy keeps running the previous deploy's code (prod, 2026-10-26: the Today
// brief kept old behaviour until a hard reload).
describe('SPA index.html caching', () => {
  const originalCwd = process.cwd();
  let tmp: string;
  let db: ReturnType<typeof createTestDb>;

  beforeAll(() => {
    // Migrations resolve from cwd, so build the DB before switching to the
    // temp dir whose dist/ the app will serve.
    db = createTestDb();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-cache-'));
    fs.mkdirSync(path.join(tmp, 'dist', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'dist', 'index.html'), '<html>shell</html>');
    fs.writeFileSync(path.join(tmp, 'dist', 'assets', 'index-abc123.js'), '1');
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
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`);
    await res.text();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return res;
  }

  it('serves the app shell for a client route with no-cache', async () => {
    const res = await get('/today');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('serves /index.html directly with no-cache', async () => {
    const res = await get('/index.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('leaves hashed assets cacheable', async () => {
    const res = await get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).not.toBe('no-cache');
  });
});
