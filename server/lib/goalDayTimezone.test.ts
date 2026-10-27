/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { computeActivityMetrics } from './activityMetricsCore.js';

// Goal windows (day/week/month) use the server's local time. On Fly the
// process ran in UTC, so from 5 PM Pacific "today" was already tomorrow:
// Today read 0 while the week and month still counted the same rows.

// 6:20 PM PDT on Mon 2026-10-26 is 01:20 UTC on Tue 2026-10-27.
const EVENING_PACIFIC = new Date('2026-10-27T01:20:00.000Z');
const APPS = [
  { dateApplied: '2026-10-26', createdAt: '2026-10-26T18:00:00.000Z', status: 'applied' },
  { dateApplied: '2026-10-25', createdAt: '2026-10-25T18:00:00.000Z', status: 'applied' },
];

// Jest ignores a runtime change to process.env.TZ, so each zone runs in its
// own process with TZ set before Node starts.
function metricsIn(tz: string) {
  const script = [
    "import { computeActivityMetrics, DEFAULT_JOB_SEARCH_GOALS } from './server/lib/activityMetricsCore.ts';",
    `const m = computeActivityMetrics(${JSON.stringify(APPS)}, DEFAULT_JOB_SEARCH_GOALS, new Date('${EVENING_PACIFIC.toISOString()}'));`,
    'console.log(JSON.stringify(m));',
  ].join('\n');
  const out = execFileSync('npx', ['tsx', '-e', script], {
    cwd: join(__dirname, '..', '..'),
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop()!) as ReturnType<typeof computeActivityMetrics>;
}

describe('goal day boundary', () => {
  it('runs the production server in Pacific time', () => {
    const flyToml = readFileSync(join(__dirname, '..', '..', 'fly.toml'), 'utf8');
    expect(flyToml).toMatch(/^\s*TZ\s*=\s*'America\/Los_Angeles'\s*$/m);
  });

  it('counts an application dated today in day, week and month on a Pacific evening', () => {
    const metrics = metricsIn('America/Los_Angeles');
    expect(metrics.applicationsToday).toBe(1);
    // Sunday 10-25 belongs to the previous Mon-start week.
    expect(metrics.applicationsThisWeek).toBe(1);
    expect(metrics.applicationsThisMonth).toBe(2);
  });

  it('reproduces the reported mismatch when the process runs in UTC', () => {
    const metrics = metricsIn('UTC');
    expect(metrics.applicationsToday).toBe(0);
    expect(metrics.applicationsThisWeek).toBe(1);
  });
});
