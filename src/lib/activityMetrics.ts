import type { Application } from '../types/application';
import type {
  ActivityHistory,
  ActivityMetrics,
  JobSearchGoals,
  ProductivityInsights,
} from '../types/activity';
import { DEFAULT_JOB_SEARCH_GOALS } from '../types/activity';

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const APPLIED_STATUSES = new Set([
  'applied',
  'recruiter_screen',
  'interviewing',
  'final_round',
  'offer',
  'rejected',
  'ghosted',
]);

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function toDateKey(date: Date): string {
  return startOfDay(date).toISOString().slice(0, 10);
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getApplicationDate(app: Application): Date | null {
  const applied = parseDate(app.dateApplied);
  if (applied) return applied;
  if (APPLIED_STATUSES.has(app.status)) {
    return parseDate(app.createdAt);
  }
  return null;
}

function getWeekStart(date: Date): Date {
  const result = startOfDay(date);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  return result;
}

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function buildProgress(current: number, goal: number) {
  const safeGoal = Math.max(goal, 1);
  return {
    current,
    goal,
    percent: Math.min(100, Math.round((current / safeGoal) * 100)),
    met: current >= goal,
  };
}

function countByDateKeys(apps: Application[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const app of apps) {
    const date = getApplicationDate(app);
    if (!date) continue;
    const key = toDateKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function computeStreaks(
  countsByDate: Map<string, number>,
  now: Date,
): { current: number; longest: number } {
  const activeDates = [...countsByDate.entries()]
    .filter(([, count]) => count > 0)
    .map(([date]) => date)
    .sort();

  if (activeDates.length === 0) {
    return { current: 0, longest: 0 };
  }

  let longest = 0;
  let run = 1;
  for (let i = 1; i < activeDates.length; i += 1) {
    const prev = parseDate(activeDates[i - 1])!;
    const cur = parseDate(activeDates[i])!;
    const diff = Math.round(
      (startOfDay(cur).getTime() - startOfDay(prev).getTime()) /
        (24 * 60 * 60 * 1000),
    );
    if (diff === 1) {
      run += 1;
    } else {
      longest = Math.max(longest, run);
      run = 1;
    }
  }
  longest = Math.max(longest, run);

  const todayKey = toDateKey(now);
  const yesterday = startOfDay(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = toDateKey(yesterday);

  let current = 0;
  const cursorKey =
    countsByDate.has(todayKey) && (countsByDate.get(todayKey) ?? 0) > 0
      ? todayKey
      : countsByDate.has(yesterdayKey) && (countsByDate.get(yesterdayKey) ?? 0) > 0
        ? yesterdayKey
        : null;

  if (cursorKey) {
    current = 1;
    const cursor = parseDate(cursorKey)!;
    for (let i = 0; i < 366; i += 1) {
      cursor.setDate(cursor.getDate() - 1);
      const key = toDateKey(cursor);
      if ((countsByDate.get(key) ?? 0) > 0) {
        current += 1;
      } else {
        break;
      }
    }
  }

  return { current, longest };
}

function countInRange(
  countsByDate: Map<string, number>,
  start: Date,
  end: Date,
): number {
  let total = 0;
  const cursor = startOfDay(start);
  const endDay = startOfDay(end);
  while (cursor <= endDay) {
    total += countsByDate.get(toDateKey(cursor)) ?? 0;
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

function computeAvgPerWeekday(
  countsByDate: Map<string, number>,
): Record<string, number> {
  const totals = new Array(7).fill(0);
  const occurrences = new Array(7).fill(0);

  for (const [dateKey, count] of countsByDate) {
    const date = parseDate(dateKey);
    if (!date) continue;
    const day = date.getDay();
    totals[day] += count;
    occurrences[day] += 1;
  }

  const result: Record<string, number> = {};
  for (let i = 0; i < 7; i += 1) {
    result[WEEKDAY_NAMES[i]] =
      occurrences[i] > 0
        ? Math.round((totals[i] / occurrences[i]) * 10) / 10
        : 0;
  }
  return result;
}

export function computeLocalActivityMetrics(
  apps: Application[],
  goals: JobSearchGoals = DEFAULT_JOB_SEARCH_GOALS,
  now: Date = new Date(),
): ActivityMetrics {
  const countsByDate = countByDateKeys(apps);
  const today = startOfDay(now);
  const weekStart = getWeekStart(now);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const { current, longest } = computeStreaks(countsByDate, now);

  return {
    applicationsToday: countsByDate.get(toDateKey(today)) ?? 0,
    applicationsThisWeek: countInRange(countsByDate, weekStart, today),
    applicationsThisMonth: countInRange(countsByDate, monthStart, today),
    currentStreak: current,
    longestStreak: longest,
    avgApplicationsPerWeekday: computeAvgPerWeekday(countsByDate),
    goals,
    progress: {
      daily: buildProgress(
        countsByDate.get(toDateKey(today)) ?? 0,
        goals.dailyGoal,
      ),
      weekly: buildProgress(
        countInRange(countsByDate, weekStart, today),
        goals.weeklyGoal,
      ),
      monthly: buildProgress(
        countInRange(countsByDate, monthStart, today),
        goals.monthlyGoal,
      ),
    },
  };
}

export function computeLocalActivityHistory(
  apps: Application[],
  goals: JobSearchGoals = DEFAULT_JOB_SEARCH_GOALS,
  now: Date = new Date(),
  days = 90,
): ActivityHistory {
  const countsByDate = countByDateKeys(apps);
  const today = startOfDay(now);

  const daily = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const key = toDateKey(date);
    const count = countsByDate.get(key) ?? 0;
    daily.push({
      date: key,
      count,
      dailyGoal: goals.dailyGoal,
      goalMet: count >= goals.dailyGoal,
    });
  }

  const weeklyMap = new Map<string, ActivityHistory['weekly'][0]>();
  for (const entry of daily) {
    const weekStart = getWeekStart(parseDate(entry.date)!);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const key = toDateKey(weekStart);
    const existing = weeklyMap.get(key);
    if (existing) {
      existing.count += entry.count;
      existing.goalMet = existing.count >= goals.weeklyGoal;
    } else {
      weeklyMap.set(key, {
        weekStart: key,
        weekEnd: toDateKey(weekEnd),
        count: entry.count,
        weeklyGoal: goals.weeklyGoal,
        goalMet: entry.count >= goals.weeklyGoal,
      });
    }
  }

  const monthlyMap = new Map<string, ActivityHistory['monthly'][0]>();
  for (const [dateKey, count] of countsByDate) {
    const month = getMonthKey(parseDate(dateKey)!);
    const existing = monthlyMap.get(month);
    if (existing) {
      existing.count += count;
      existing.goalMet = existing.count >= goals.monthlyGoal;
    } else {
      monthlyMap.set(month, {
        month,
        count,
        monthlyGoal: goals.monthlyGoal,
        goalMet: count >= goals.monthlyGoal,
      });
    }
  }

  const streakHistory: { date: string; streakDays: number }[] = [];
  let streak = 0;
  for (const entry of daily) {
    streak = entry.count > 0 ? streak + 1 : 0;
    if (entry.count > 0) {
      streakHistory.push({ date: entry.date, streakDays: streak });
    }
  }

  return {
    daily,
    weekly: [...weeklyMap.values()].sort((a, b) =>
      a.weekStart.localeCompare(b.weekStart),
    ),
    monthly: [...monthlyMap.values()].sort((a, b) =>
      a.month.localeCompare(b.month),
    ),
    streakHistory,
  };
}

export function computeLocalProductivityInsights(
  apps: Application[],
  now: Date = new Date(),
): ProductivityInsights {
  const metrics = computeLocalActivityMetrics(apps, DEFAULT_JOB_SEARCH_GOALS, now);
  const countsByDate = countByDateKeys(apps);

  let bestDay = WEEKDAY_NAMES[0];
  let bestAvg = 0;
  for (const [day, avg] of Object.entries(metrics.avgApplicationsPerWeekday)) {
    if (avg > bestAvg) {
      bestAvg = avg;
      bestDay = day;
    }
  }

  const weeklyTotals: number[] = [];
  const today = startOfDay(now);
  for (let w = 0; w < 12; w += 1) {
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() - w * 7);
    const weekStart = getWeekStart(weekEnd);
    weeklyTotals.push(countInRange(countsByDate, weekStart, weekEnd));
  }

  const monthlyCounts = new Map<string, number>();
  for (const [dateKey, count] of countsByDate) {
    const month = getMonthKey(parseDate(dateKey)!);
    monthlyCounts.set(month, (monthlyCounts.get(month) ?? 0) + count);
  }
  let mostProductiveMonth: string | null = null;
  let maxMonthCount = 0;
  for (const [month, count] of monthlyCounts) {
    if (count > maxMonthCount) {
      maxMonthCount = count;
      mostProductiveMonth = month;
    }
  }

  return {
    bestApplicationDayOfWeek: bestDay,
    avgApplicationsPerWeek:
      weeklyTotals.length > 0
        ? Math.round(
            (weeklyTotals.reduce((a, b) => a + b, 0) / weeklyTotals.length) * 10,
          ) / 10
        : 0,
    mostProductiveMonth,
    longestStreak: metrics.longestStreak,
    avgApplicationsBeforeFirstResponse: null,
    recruiterResponseRate: null,
    interviewRate: null,
    offerRate: null,
  };
}
