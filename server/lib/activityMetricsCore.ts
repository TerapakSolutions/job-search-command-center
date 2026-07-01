export interface JobSearchGoals {
  dailyGoal: number;
  weeklyGoal: number;
  monthlyGoal: number;
}

export const DEFAULT_JOB_SEARCH_GOALS: JobSearchGoals = {
  dailyGoal: 5,
  weeklyGoal: 25,
  monthlyGoal: 100,
};

export interface GoalProgress {
  current: number;
  goal: number;
  percent: number;
  met: boolean;
}

export interface ActivityMetrics {
  applicationsToday: number;
  applicationsThisWeek: number;
  applicationsThisMonth: number;
  currentStreak: number;
  longestStreak: number;
  avgApplicationsPerWeekday: Record<string, number>;
  goals: JobSearchGoals;
  progress: {
    daily: GoalProgress;
    weekly: GoalProgress;
    monthly: GoalProgress;
  };
}

export interface DailyActivityEntry {
  date: string;
  count: number;
  dailyGoal: number;
  goalMet: boolean;
}

export interface WeeklyActivitySummary {
  weekStart: string;
  weekEnd: string;
  count: number;
  weeklyGoal: number;
  goalMet: boolean;
}

export interface MonthlyActivitySummary {
  month: string;
  count: number;
  monthlyGoal: number;
  goalMet: boolean;
}

export interface ActivityHistory {
  daily: DailyActivityEntry[];
  weekly: WeeklyActivitySummary[];
  monthly: MonthlyActivitySummary[];
  streakHistory: { date: string; streakDays: number }[];
}

export interface ProductivityInsights {
  bestApplicationDayOfWeek: string;
  avgApplicationsPerWeek: number;
  mostProductiveMonth: string | null;
  longestStreak: number;
  avgApplicationsBeforeFirstResponse: number | null;
  recruiterResponseRate: number | null;
  interviewRate: number | null;
  offerRate: number | null;
}

export interface ApplicationActivityInput {
  dateApplied: string | null;
  createdAt: string;
  status: string;
}

export interface OutcomeMetricInput {
  daysToFirstResponse: number | null;
  hadRecruiterResponse: boolean;
  hadInterview: boolean;
  receivedOffer: boolean;
}

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

function getApplicationDate(app: ApplicationActivityInput): Date | null {
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

function buildProgress(current: number, goal: number): GoalProgress {
  const safeGoal = Math.max(goal, 1);
  return {
    current,
    goal,
    percent: Math.min(100, Math.round((current / safeGoal) * 100)),
    met: current >= goal,
  };
}

function countByDateKeys(
  apps: ApplicationActivityInput[],
): Map<string, number> {
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
  let cursorKey =
    countsByDate.has(todayKey) && (countsByDate.get(todayKey) ?? 0) > 0
      ? todayKey
      : countsByDate.has(yesterdayKey) && (countsByDate.get(yesterdayKey) ?? 0) > 0
        ? yesterdayKey
        : null;

  if (cursorKey) {
    current = 1;
    let cursor = parseDate(cursorKey)!;
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

export function computeActivityMetrics(
  apps: ApplicationActivityInput[],
  goals: JobSearchGoals = DEFAULT_JOB_SEARCH_GOALS,
  now: Date = new Date(),
): ActivityMetrics {
  const countsByDate = countByDateKeys(apps);
  const today = startOfDay(now);
  const weekStart = getWeekStart(now);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const applicationsToday = countsByDate.get(toDateKey(today)) ?? 0;
  const applicationsThisWeek = countInRange(countsByDate, weekStart, today);
  const applicationsThisMonth = countInRange(countsByDate, monthStart, today);
  const { current, longest } = computeStreaks(countsByDate, now);

  return {
    applicationsToday,
    applicationsThisWeek,
    applicationsThisMonth,
    currentStreak: current,
    longestStreak: longest,
    avgApplicationsPerWeekday: computeAvgPerWeekday(countsByDate),
    goals,
    progress: {
      daily: buildProgress(applicationsToday, goals.dailyGoal),
      weekly: buildProgress(applicationsThisWeek, goals.weeklyGoal),
      monthly: buildProgress(applicationsThisMonth, goals.monthlyGoal),
    },
  };
}

export function computeActivityHistory(
  apps: ApplicationActivityInput[],
  goals: JobSearchGoals = DEFAULT_JOB_SEARCH_GOALS,
  now: Date = new Date(),
  days = 90,
): ActivityHistory {
  const countsByDate = countByDateKeys(apps);
  const today = startOfDay(now);

  const daily: DailyActivityEntry[] = [];
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

  const weeklyMap = new Map<string, WeeklyActivitySummary>();
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

  const monthlyMap = new Map<string, MonthlyActivitySummary>();
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
    if (entry.count > 0) {
      streak += 1;
    } else {
      streak = 0;
    }
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

export function computeProductivityInsights(
  apps: ApplicationActivityInput[],
  outcomes: OutcomeMetricInput[],
  now: Date = new Date(),
): ProductivityInsights {
  const metrics = computeActivityMetrics(apps, DEFAULT_JOB_SEARCH_GOALS, now);
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
  const avgApplicationsPerWeek =
    weeklyTotals.length > 0
      ? Math.round(
          (weeklyTotals.reduce((a, b) => a + b, 0) / weeklyTotals.length) * 10,
        ) / 10
      : 0;

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

  const responseDays = outcomes
    .map((o) => o.daysToFirstResponse)
    .filter((d): d is number => d !== null);
  const avgApplicationsBeforeFirstResponse =
    responseDays.length > 0
      ? Math.round(
          (responseDays.reduce((a, b) => a + b, 0) / responseDays.length) * 10,
        ) / 10
      : null;

  const appliedCount = apps.filter((a) => APPLIED_STATUSES.has(a.status)).length;
  const withResponse = outcomes.filter((o) => o.hadRecruiterResponse).length;
  const withInterview = outcomes.filter((o) => o.hadInterview).length;
  const withOffer = outcomes.filter((o) => o.receivedOffer).length;

  return {
    bestApplicationDayOfWeek: bestDay,
    avgApplicationsPerWeek,
    mostProductiveMonth,
    longestStreak: metrics.longestStreak,
    avgApplicationsBeforeFirstResponse,
    recruiterResponseRate:
      appliedCount > 0 ? Math.round((withResponse / appliedCount) * 100) : null,
    interviewRate:
      appliedCount > 0 ? Math.round((withInterview / appliedCount) * 100) : null,
    offerRate:
      appliedCount > 0 ? Math.round((withOffer / appliedCount) * 100) : null,
  };
}

export function buildGoalBriefingMessages(
  metrics: ActivityMetrics,
): string[] {
  const messages: string[] = [];
  const { progress, currentStreak, applicationsToday, goals } = metrics;

  messages.push(
    `You applied to ${applicationsToday} job${applicationsToday === 1 ? '' : 's'} today. Your goal is ${goals.dailyGoal}.`,
  );

  if (progress.daily.met) {
    messages.push('Great work — you hit your daily application goal!');
  } else if (applicationsToday === 0) {
    messages.push(
      `You're behind on today's goal. ${goals.dailyGoal} applications would keep you on track.`,
    );
  } else {
    const remaining = goals.dailyGoal - applicationsToday;
    messages.push(
      `${remaining} more application${remaining === 1 ? '' : 's'} to reach today's goal.`,
    );
  }

  if (currentStreak >= 7) {
    messages.push(
      `Impressive ${currentStreak}-day application streak! Keep the momentum going.`,
    );
  } else if (currentStreak >= 3) {
    messages.push(
      `You're on a ${currentStreak}-day streak. Consistency builds results.`,
    );
  }

  if (!progress.weekly.met) {
    const dayOfWeek = startOfDay(new Date()).getDay();
    const daysLeftInWeek = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    const weeklyRemaining = goals.weeklyGoal - progress.weekly.current;
    if (daysLeftInWeek <= 2 && weeklyRemaining > 0) {
      messages.push(
        `Weekly pace alert: ${weeklyRemaining} applications needed with ${daysLeftInWeek} day${daysLeftInWeek === 1 ? '' : 's'} left this week.`,
      );
    }
  }

  const today = startOfDay(new Date());
  const daysInMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  ).getDate();
  const dayOfMonth = today.getDate();
  const daysLeftInMonth = daysInMonth - dayOfMonth;
  const expectedMonthly =
    (goals.monthlyGoal / daysInMonth) * dayOfMonth;
  if (
    progress.monthly.current < expectedMonthly * 0.8 &&
    daysLeftInMonth <= 7
  ) {
    messages.push(
      `Monthly goal at risk: ${progress.monthly.current}/${goals.monthlyGoal} applications with ${daysLeftInMonth} days remaining.`,
    );
  }

  return messages;
}
