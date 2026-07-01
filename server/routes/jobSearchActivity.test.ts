/** @jest-environment node */

import http from 'node:http';
import { createApp } from '../app.js';
import { createSessionToken } from '../lib/session.js';
import { createTestDb, seedApplication, seedTestUser } from '../lib/testDb.js';

function startServer(db: ReturnType<typeof createTestDb>) {
  process.env.SESSION_SECRET = 'test-session-secret-for-activity';
  const app = createApp(db);
  const server = http.createServer(app);
  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

describe('jobSearchActivity routes', () => {
  it('manages goals and returns activity endpoints', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));

    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId, {
      id: 'metrics-app-1',
      dateApplied: '2026-07-01',
      status: 'applied',
    });

    const { baseUrl, close } = await startServer(db);
    const cookie = `session=${encodeURIComponent(createSessionToken(userId))}`;

    const goalsRes = await fetch(`${baseUrl}/api/job-search-goals`, {
      headers: { Cookie: cookie },
    });
    expect(goalsRes.status).toBe(200);
    const goals = (await goalsRes.json()) as {
      dailyGoal: number;
      weeklyGoal: number;
      monthlyGoal: number;
    };
    expect(goals.dailyGoal).toBe(5);
    expect(goals.weeklyGoal).toBe(25);
    expect(goals.monthlyGoal).toBe(100);

    const updateRes = await fetch(`${baseUrl}/api/job-search-goals`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dailyGoal: 10, weeklyGoal: 40, monthlyGoal: 120 }),
    });
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as { dailyGoal: number };
    expect(updated.dailyGoal).toBe(10);

    const metricsRes = await fetch(`${baseUrl}/api/activity/metrics`, {
      headers: { Cookie: cookie },
    });
    expect(metricsRes.status).toBe(200);
    const metrics = (await metricsRes.json()) as {
      applicationsToday: number;
      progress: { daily: { current: number } };
    };
    expect(metrics.applicationsToday).toBeGreaterThanOrEqual(1);
    expect(metrics.progress.daily).toBeDefined();

    const historyRes = await fetch(`${baseUrl}/api/activity/history?days=30`, {
      headers: { Cookie: cookie },
    });
    expect(historyRes.status).toBe(200);
    const history = (await historyRes.json()) as { daily: unknown[] };
    expect(Array.isArray(history.daily)).toBe(true);

    const insightsRes = await fetch(`${baseUrl}/api/activity/insights`, {
      headers: { Cookie: cookie },
    });
    expect(insightsRes.status).toBe(200);
    const insights = (await insightsRes.json()) as {
      bestApplicationDayOfWeek: string;
      longestStreak: number;
    };
    expect(insights.bestApplicationDayOfWeek).toBeDefined();
    expect(insights.longestStreak).toBeDefined();

    await close();
    jest.useRealTimers();
  });
});
