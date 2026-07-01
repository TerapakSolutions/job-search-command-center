export interface JobSearchGoals {
  id?: string;
  userId?: string;
  dailyGoal: number;
  weeklyGoal: number;
  monthlyGoal: number;
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
