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
// own process with TZ set before Node starts. The script's last line is JSON.
function runIn<T>(tz: string, lines: string[], env: NodeJS.ProcessEnv = {}): T {
  const out = execFileSync('npx', ['tsx', '-e', lines.join('\n')], {
    cwd: join(__dirname, '..', '..'),
    env: { ...process.env, ...env, TZ: tz },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop()!) as T;
}

function metricsIn(tz: string) {
  return runIn<ReturnType<typeof computeActivityMetrics>>(tz, [
    "import { computeActivityMetrics, DEFAULT_JOB_SEARCH_GOALS } from './server/lib/activityMetricsCore.ts';",
    `const m = computeActivityMetrics(${JSON.stringify(APPS)}, DEFAULT_JOB_SEARCH_GOALS, new Date('${EVENING_PACIFIC.toISOString()}'));`,
    'console.log(JSON.stringify(m));',
  ]);
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

describe('Inbound Emails date filter in Pacific time', () => {
  it('a from/to date of 2026-10-26 covers that whole Pacific day', () => {
    const ids = runIn<string[]>('America/Los_Angeles', [
      "import { listInboundEmailsForUser } from './server/lib/inboundEmailService.ts';",
      "import { createTestDb, seedInboundEmail, seedTestUser } from './server/lib/testDb.ts';",
      'const db = createTestDb();',
      "const userId = seedTestUser(db, { email: 'seeker@example.com' });",
      // 10 PM on the 25th, 9 AM on the 26th, 6:20 PM on the 26th (Pacific).
      "seedInboundEmail(db, { id: 'day-before', toEmail: 'seeker@example.com', receivedAt: '2026-10-26T05:00:00.000Z' });",
      "seedInboundEmail(db, { id: 'morning', toEmail: 'seeker@example.com', receivedAt: '2026-10-26T16:00:00.000Z' });",
      "seedInboundEmail(db, { id: 'evening', toEmail: 'seeker@example.com', receivedAt: '2026-10-27T01:20:00.000Z' });",
      "const r = listInboundEmailsForUser(db, userId, { fromDate: '2026-10-26', toDate: '2026-10-26' });",
      'console.log(JSON.stringify(r.items.map((e) => e.id)));',
    ]);
    expect(ids).toEqual(['evening', 'morning']);
  });
});

describe('applied date of an evening confirmation in Pacific time', () => {
  it('is the Pacific calendar day the employer sent it', () => {
    const dates = runIn<(string | null)[]>('America/Los_Angeles', [
      "import { applications } from './server/db/schema.ts';",
      "import { listPendingApprovalsForUser, resolvePendingApproval } from './server/lib/emailAutomationService.ts';",
      "import { processInboundEmail } from './server/lib/inboundEmailProcessingService.ts';",
      "import { saveInboundEmail } from './server/lib/postmarkInbound.ts';",
      "import { createTestDb, seedTestUser } from './server/lib/testDb.ts';",
      'void (async () => {',
      'const db = createTestDb();',
      "const userId = seedTestUser(db, { email: 'seeker@example.com' });",
      'const id = await saveInboundEmail(db, {',
      "  Subject: 'Fwd: Thank you for applying to Acme!',",
      "  FromFull: { Email: 'seeker@example.com' },",
      "  OriginalRecipient: 'seeker@example.com',",
      "  MessageID: 'evening-1',",
      "  Date: 'Tue, 27 Oct 2026 01:40:00 +0000',",
      // 5:30 PM PDT on the 26th is 00:30 UTC on the 27th.
      '  TextBody: "Begin forwarded message:\\n\\nFrom: Acme Hiring <no-reply@ashbyhq.com>\\nSubject: Thank you for applying to Acme!\\nDate: October 26, 2026 at 5:30:00 PM PDT\\nTo: seeker@example.com\\n\\nHi Alex,\\n\\nWe\'ve received your application for the Platform Engineer role at Acme!",',
      '});',
      'await processInboundEmail(db, id, { userId, manual: true });',
      'for (const a of listPendingApprovalsForUser(db, userId)) resolvePendingApproval(db, userId, a.id, \'approved\');',
      'console.log(JSON.stringify(db.select().from(applications).all().map((a) => a.dateApplied)));',
      '})();',
    ], { OPENAI_API_KEY: '' });
    expect(dates).toEqual(['2026-10-26']);
  });
});
