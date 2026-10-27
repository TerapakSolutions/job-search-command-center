/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// The server runs in Pacific time (fly.toml TZ). The brief used to be keyed by
// the UTC day and written at 06:00 UTC, which is 11 PM Pacific the night
// before, so the morning brief described yesterday under today's date and the
// date flipped at 5 PM. It now runs at 6 AM Pacific, keyed by the Pacific day.

// Jest ignores a runtime change to process.env.TZ, so run in a child process.
function inPacific<T>(lines: string[]): T {
  const out = execFileSync('npx', ['tsx', '-e', lines.join('\n')], {
    cwd: join(__dirname, '..', '..'),
    env: { ...process.env, TZ: 'America/Los_Angeles' },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop()!) as T;
}

describe('daily brief schedule in Pacific time', () => {
  it('dates a brief by the Pacific day, not the UTC day', () => {
    const dates = inPacific<string[]>([
      "import { toBriefingDate } from './server/lib/briefingTypes.ts';",
      // 6 PM PDT on Oct 27 is 01:00 UTC on Oct 28.
      "console.log(JSON.stringify([toBriefingDate(new Date('2026-10-28T01:00:00Z')), toBriefingDate('2026-10-27T16:00:00Z')]));",
    ]);
    expect(dates).toEqual(['2026-10-27', '2026-10-27']);
  });

  it('writes the brief at 6 AM Pacific, not 11 PM the night before', () => {
    const due = inPacific<Record<string, boolean>>([
      "import { isBriefingDue } from './server/lib/dailyBriefingScheduler.ts';",
      'console.log(JSON.stringify({',
      // 11 PM PDT Oct 27 = 06:00 UTC Oct 28: the old run time, which wrote
      // the Oct 28 brief the night before. Oct 27's 6 AM run already happened.
      "  elevenPmNightBefore: isBriefingDue(new Date('2026-10-28T06:00:00Z'), '2026-10-27'),",
      "  fiveThirtyAm: isBriefingDue(new Date('2026-10-28T12:30:00Z'), null),",
      "  sixAm: isBriefingDue(new Date('2026-10-28T13:05:00Z'), null),",
      "  alreadyRanToday: isBriefingDue(new Date('2026-10-28T15:00:00Z'), '2026-10-28'),",
      // After DST ends: 6 AM PST is 14:00 UTC.
      "  sixAmPst: isBriefingDue(new Date('2026-11-03T14:05:00Z'), '2026-11-02'),",
      '}));',
    ]);
    expect(due).toEqual({
      elevenPmNightBefore: false,
      fiveThirtyAm: false,
      sixAm: true,
      alreadyRanToday: false,
      sixAmPst: true,
    });
  });
});
