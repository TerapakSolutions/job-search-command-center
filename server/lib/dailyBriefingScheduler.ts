import type { Db } from '../db/index.js';
import { generateDailyBriefingsForAllUsers } from './briefingGenerator.js';
import { toBriefingDate } from './briefingTypes.js';

let lastRunDate: string | null = null;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

// Server local time (Pacific on Fly), so the brief is ready each morning.
function getScheduledHour(): number {
  const raw = process.env.DAILY_BRIEFING_HOUR;
  if (!raw) return 6;
  const hour = Number(raw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return 6;
  return hour;
}

export function isBriefingDue(now: Date, lastRun: string | null): boolean {
  return lastRun !== toBriefingDate(now) && now.getHours() >= getScheduledHour();
}

export function isAutoScheduleEnabled(): boolean {
  return process.env.DAILY_BRIEFING_AUTO_SCHEDULE !== 'false';
}

export async function runDailyBriefingJob(
  db: Db,
  now: Date = new Date(),
): Promise<{ generated: number; skipped: number; failed: number }> {
  if (running) {
    return { generated: 0, skipped: 0, failed: 0 };
  }
  running = true;
  try {
    console.log('[daily-briefing] Starting scheduled generation');
    const result = await generateDailyBriefingsForAllUsers(db, now);
    console.log('[daily-briefing] Completed', result);
    lastRunDate = toBriefingDate(now);
    return result;
  } finally {
    running = false;
  }
}

export function startDailyBriefingScheduler(db: Db): void {
  if (!isAutoScheduleEnabled()) {
    console.log(
      '[daily-briefing] Auto schedule disabled (DAILY_BRIEFING_AUTO_SCHEDULE=false)',
    );
    return;
  }

  if (intervalHandle) return;

  console.log(
    `[daily-briefing] Scheduler active — checks hourly, runs once daily after ${getScheduledHour()}:00 local time`,
  );

  const tick = () => {
    const now = new Date();
    if (!isBriefingDue(now, lastRunDate)) return;

    void runDailyBriefingJob(db, now).catch((err) => {
      console.error('[daily-briefing] Scheduler run failed', err);
    });
  };

  tick();
  intervalHandle = setInterval(tick, 60 * 60 * 1000);
}

export function stopDailyBriefingScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/** Test helper — reset scheduler state */
export function resetSchedulerStateForTests(): void {
  lastRunDate = null;
  running = false;
  stopDailyBriefingScheduler();
}

export function getLastRunDateForTests(): string | null {
  return lastRunDate;
}
