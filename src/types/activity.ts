export interface JobSearchGoals {
  id?: string;
  userId?: string;
  dailyGoal: number;
  weeklyGoal: number;
  monthlyGoal: number;
  /** Null until the user saves goals; until then the targets are placeholders. */
  goalsSetAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
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
  /** False while the goals are the untouched defaults; absent means unknown. */
  goalsSetByUser?: boolean;
  /** True in the week/month goals were first set: targets scaled, no pace alerts. */
  firstPeriod?: { week: boolean; month: boolean };
  /** The targets as saved, when `goals` holds scaled first-period ones. */
  savedGoals?: JobSearchGoals;
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

export interface BriefingGoalProgress {
  applicationsToday: number;
  applicationsThisWeek: number;
  applicationsThisMonth: number;
  currentStreak: number;
  longestStreak: number;
  dailyGoal: number;
  weeklyGoal: number;
  monthlyGoal: number;
  dailyMet: boolean;
  weeklyMet: boolean;
  monthlyMet: boolean;
  goalMessages: string[];
}
