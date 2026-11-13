/** @jest-environment node */
import http from 'node:http';
import { createApp } from '../app.js';
import { createTestDb } from '../lib/testDb.js';

async function getConfig(): Promise<unknown> {
  const server = http.createServer(createApp(createTestDb()));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/auth/config`);
    return await res.json();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('GET /auth/config (no sign-in needed)', () => {
  const saved = process.env.SUPPORT_EMAIL;
  const savedFeedback = process.env.FEEDBACK_ENABLED;
  beforeEach(() => {
    delete process.env.FEEDBACK_ENABLED;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SUPPORT_EMAIL;
    else process.env.SUPPORT_EMAIL = saved;
    if (savedFeedback === undefined) delete process.env.FEEDBACK_ENABLED;
    else process.env.FEEDBACK_ENABLED = savedFeedback;
  });

  it('returns the support address when one is set', async () => {
    process.env.SUPPORT_EMAIL = ' help@example.com ';
    expect(await getConfig()).toEqual({ supportEmail: 'help@example.com', feedbackEnabled: false });
  });

  it('returns null when none is set', async () => {
    delete process.env.SUPPORT_EMAIL;
    expect(await getConfig()).toEqual({ supportEmail: null, feedbackEnabled: false });
  });

  it('says feedback is on only when FEEDBACK_ENABLED is exactly "true"', async () => {
    delete process.env.SUPPORT_EMAIL;
    process.env.FEEDBACK_ENABLED = 'true';
    expect(await getConfig()).toEqual({ supportEmail: null, feedbackEnabled: true });
    process.env.FEEDBACK_ENABLED = '1';
    expect(await getConfig()).toEqual({ supportEmail: null, feedbackEnabled: false });
  });
});
