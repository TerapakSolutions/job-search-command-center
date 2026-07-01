import type { ActivityMetrics } from '../types/activity';
import type { Reminder } from '../types/reminder';
import { startOfDay } from './dates';

const STREAK_MILESTONES = [3, 7, 14, 30];

export function computeGoalReminders(
  metrics: ActivityMetrics,
  now = new Date(),
): Reminder[] {
  const reminders: Reminder[] = [];
  const today = startOfDay(now);
  const todayIso = today.toISOString();
  const hour = now.getHours();

  const { progress, currentStreak, goals } = metrics;

  if (!progress.daily.met && hour >= 17) {
    const remaining = goals.dailyGoal - progress.daily.current;
    reminders.push({
      id: 'goal-daily-behind',
      type: 'daily_goal_behind',
      priority: 'high',
      title: 'Daily goal not met',
      description: `${remaining} more application${remaining === 1 ? '' : 's'} needed to hit today's goal of ${goals.dailyGoal}.`,
      applicationId: '',
      dueDate: todayIso,
    });
  }

  const dayOfWeek = today.getDay();
  const daysLeftInWeek = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  if (!progress.weekly.met && daysLeftInWeek <= 2) {
    const remaining = goals.weeklyGoal - progress.weekly.current;
    reminders.push({
      id: 'goal-weekly-pace',
      type: 'weekly_pace_behind',
      priority: 'medium',
      title: 'Weekly pace behind',
      description: `${remaining} applications needed with ${daysLeftInWeek} day${daysLeftInWeek === 1 ? '' : 's'} left this week.`,
      applicationId: '',
      dueDate: todayIso,
    });
  }

  const daysInMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  ).getDate();
  const dayOfMonth = today.getDate();
  const daysLeftInMonth = daysInMonth - dayOfMonth;
  const expectedMonthly = (goals.monthlyGoal / daysInMonth) * dayOfMonth;
  if (
    progress.monthly.current < expectedMonthly * 0.8 &&
    daysLeftInMonth <= 7
  ) {
    reminders.push({
      id: 'goal-monthly-risk',
      type: 'monthly_goal_at_risk',
      priority: 'medium',
      title: 'Monthly goal at risk',
      description: `${progress.monthly.current}/${goals.monthlyGoal} applications with ${daysLeftInMonth} days remaining.`,
      applicationId: '',
      dueDate: todayIso,
    });
  }

  for (const milestone of STREAK_MILESTONES) {
    if (currentStreak === milestone) {
      reminders.push({
        id: `goal-streak-${milestone}`,
        type: 'streak_milestone',
        priority: 'low',
        title: `${milestone}-day streak!`,
        description: `Congratulations on ${milestone} consecutive days of applications. Keep it up!`,
        applicationId: '',
        dueDate: todayIso,
      });
    }
  }

  if (progress.daily.met && progress.daily.current > 0) {
    reminders.push({
      id: 'goal-daily-met',
      type: 'daily_goal_met',
      priority: 'low',
      title: 'Daily goal achieved',
      description: `You hit your daily target of ${goals.dailyGoal} applications. Nice work!`,
      applicationId: '',
      dueDate: todayIso,
    });
  }

  return reminders;
}
