import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import {
  applications,
  communications,
  interviews,
  jobSearchGoals,
  applicationOutcomeMetrics,
} from '../db/schema.js';
import { createId, nowIso } from './id.js';
import {
  computeActivityHistory,
  computeActivityMetrics,
  computeProductivityInsights,
  DEFAULT_JOB_SEARCH_GOALS,
  type ActivityHistory,
  type ActivityMetrics,
  type JobSearchGoals,
  type OutcomeMetricInput,
  type ProductivityInsights,
} from './activityMetricsCore.js';

export type {
  ActivityHistory,
  ActivityMetrics,
  JobSearchGoals,
  ProductivityInsights,
} from './activityMetricsCore.js';
export { DEFAULT_JOB_SEARCH_GOALS } from './activityMetricsCore.js';

export interface JobSearchGoalsRecord extends JobSearchGoals {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

function rowToGoals(row: typeof jobSearchGoals.$inferSelect): JobSearchGoalsRecord {
  return {
    id: row.id,
    userId: row.userId,
    dailyGoal: row.dailyGoal,
    weeklyGoal: row.weeklyGoal,
    monthlyGoal: row.monthlyGoal,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function getJobSearchGoals(
  db: Db,
  userId: string,
): JobSearchGoalsRecord {
  const rows = db
    .select()
    .from(jobSearchGoals)
    .where(eq(jobSearchGoals.userId, userId))
    .all();

  if (rows[0]) {
    return rowToGoals(rows[0]);
  }

  const timestamp = nowIso();
  const id = createId();
  db.insert(jobSearchGoals)
    .values({
      id,
      userId,
      dailyGoal: DEFAULT_JOB_SEARCH_GOALS.dailyGoal,
      weeklyGoal: DEFAULT_JOB_SEARCH_GOALS.weeklyGoal,
      monthlyGoal: DEFAULT_JOB_SEARCH_GOALS.monthlyGoal,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  return {
    id,
    userId,
    ...DEFAULT_JOB_SEARCH_GOALS,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updateJobSearchGoals(
  db: Db,
  userId: string,
  input: Partial<JobSearchGoals>,
): JobSearchGoalsRecord {
  const existing = getJobSearchGoals(db, userId);
  const timestamp = nowIso();
  const dailyGoal =
    input.dailyGoal !== undefined
      ? Math.max(1, Math.round(Number(input.dailyGoal)))
      : existing.dailyGoal;
  const weeklyGoal =
    input.weeklyGoal !== undefined
      ? Math.max(1, Math.round(Number(input.weeklyGoal)))
      : existing.weeklyGoal;
  const monthlyGoal =
    input.monthlyGoal !== undefined
      ? Math.max(1, Math.round(Number(input.monthlyGoal)))
      : existing.monthlyGoal;

  db.update(jobSearchGoals)
    .set({
      dailyGoal,
      weeklyGoal,
      monthlyGoal,
      updatedAt: timestamp,
    })
    .where(eq(jobSearchGoals.userId, userId))
    .run();

  return {
    ...existing,
    dailyGoal,
    weeklyGoal,
    monthlyGoal,
    updatedAt: timestamp,
  };
}

function getUserApplications(db: Db, userId: string) {
  return db
    .select()
    .from(applications)
    .where(eq(applications.userId, userId))
    .all();
}

export function getActivityMetrics(
  db: Db,
  userId: string,
  now: Date = new Date(),
): ActivityMetrics {
  const goalsRecord = getJobSearchGoals(db, userId);
  const apps = getUserApplications(db, userId);
  return computeActivityMetrics(
    apps,
    {
      dailyGoal: goalsRecord.dailyGoal,
      weeklyGoal: goalsRecord.weeklyGoal,
      monthlyGoal: goalsRecord.monthlyGoal,
    },
    now,
  );
}

export function getActivityHistory(
  db: Db,
  userId: string,
  days = 90,
  now: Date = new Date(),
): ActivityHistory {
  const goalsRecord = getJobSearchGoals(db, userId);
  const apps = getUserApplications(db, userId);
  return computeActivityHistory(
    apps,
    {
      dailyGoal: goalsRecord.dailyGoal,
      weeklyGoal: goalsRecord.weeklyGoal,
      monthlyGoal: goalsRecord.monthlyGoal,
    },
    now,
    days,
  );
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(from: Date, to: Date): number {
  const a = new Date(from);
  const b = new Date(to);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

export function computeAndStoreOutcomeMetrics(
  db: Db,
  userId: string,
  now: Date = new Date(),
): void {
  const apps = getUserApplications(db, userId);
  const comms = db
    .select()
    .from(communications)
    .where(eq(communications.userId, userId))
    .all();
  const interviewRows = db
    .select()
    .from(interviews)
    .where(eq(interviews.userId, userId))
    .all();

  const timestamp = nowIso();

  for (const app of apps) {
    const appliedDate =
      parseDate(app.dateApplied) ?? parseDate(app.createdAt);
    const appComms = comms
      .filter(
        (c) =>
          c.applicationId === app.id &&
          c.direction === 'inbound',
      )
      .sort(
        (a, b) =>
          new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
      );
    const appInterviews = interviewRows
      .filter((iv) => iv.applicationId === app.id)
      .sort(
        (a, b) =>
          new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
      );

    const firstResponse = appComms[0] ?? null;
    const firstInterview = appInterviews[0] ?? null;
    const hadRecruiterResponse = firstResponse !== null;
    const hadInterview =
      appInterviews.length > 0 ||
      ['interviewing', 'final_round', 'offer'].includes(app.status);
    const receivedOffer = app.status === 'offer';

    const firstRecruiterResponseAt = firstResponse?.occurredAt ?? null;
    const firstInterviewAt =
      firstInterview?.scheduledAt ?? app.interviewDate ?? null;
    const offerReceivedAt = receivedOffer ? app.updatedAt : null;

    const daysToFirstResponse =
      appliedDate && firstRecruiterResponseAt
        ? daysBetween(appliedDate, parseDate(firstRecruiterResponseAt)!)
        : null;
    const daysApplicationToInterview =
      appliedDate && firstInterviewAt
        ? daysBetween(appliedDate, parseDate(firstInterviewAt)!)
        : null;
    const daysInterviewToOffer =
      firstInterviewAt && offerReceivedAt
        ? daysBetween(parseDate(firstInterviewAt)!, parseDate(offerReceivedAt)!)
        : null;

    const existing = db
      .select()
      .from(applicationOutcomeMetrics)
      .where(eq(applicationOutcomeMetrics.applicationId, app.id))
      .all()[0];

    const values = {
      firstRecruiterResponseAt,
      firstInterviewAt,
      offerReceivedAt,
      daysToFirstResponse,
      daysApplicationToInterview,
      daysInterviewToOffer,
      hadRecruiterResponse,
      hadInterview,
      receivedOffer,
      lastComputedAt: timestamp,
      updatedAt: timestamp,
    };

    if (existing) {
      db.update(applicationOutcomeMetrics)
        .set(values)
        .where(eq(applicationOutcomeMetrics.id, existing.id))
        .run();
    } else {
      db.insert(applicationOutcomeMetrics)
        .values({
          id: createId(),
          userId,
          applicationId: app.id,
          ...values,
          createdAt: timestamp,
        })
        .run();
    }
  }
}

export function getProductivityInsights(
  db: Db,
  userId: string,
  now: Date = new Date(),
): ProductivityInsights {
  computeAndStoreOutcomeMetrics(db, userId, now);
  const apps = getUserApplications(db, userId);
  const outcomeRows = db
    .select()
    .from(applicationOutcomeMetrics)
    .where(eq(applicationOutcomeMetrics.userId, userId))
    .all();

  const outcomes: OutcomeMetricInput[] = outcomeRows.map((row) => ({
    daysToFirstResponse: row.daysToFirstResponse,
    hadRecruiterResponse: row.hadRecruiterResponse,
    hadInterview: row.hadInterview,
    receivedOffer: row.receivedOffer,
  }));

  return computeProductivityInsights(apps, outcomes, now);
}
