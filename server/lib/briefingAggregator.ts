import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import {
  applications,
  communications,
  contacts,
  dailyBriefings,
  inboundEmails,
  interviews,
  users,
} from '../db/schema.js';
import type { BriefingData, BriefingPipelineStats } from './briefingTypes.js';
import { toBriefingDate } from './briefingTypes.js';

const ACTIVE_STATUSES = new Set([
  'saved',
  'applied',
  'recruiter_screen',
  'interviewing',
  'final_round',
]);

const INACTIVE_DAYS = 14;
const OVERNIGHT_HOURS = 12;

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isInWindow(iso: string, start: Date, end: Date): boolean {
  const d = parseDate(iso);
  if (!d) return false;
  return d >= start && d <= end;
}

function daysBetween(from: Date, to: Date): number {
  const a = new Date(from);
  const b = new Date(to);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

function computePipelineStats(
  apps: (typeof applications.$inferSelect)[],
): BriefingPipelineStats {
  const byStatus: Record<string, number> = {};
  for (const app of apps) {
    byStatus[app.status] = (byStatus[app.status] ?? 0) + 1;
  }
  return {
    total: apps.length,
    byStatus,
    active: apps.filter((a) => ACTIVE_STATUSES.has(a.status)).length,
    offers: byStatus.offer ?? 0,
    rejected: byStatus.rejected ?? 0,
    ghosted: byStatus.ghosted ?? 0,
  };
}

function toAppRef(app: typeof applications.$inferSelect) {
  return {
    id: app.id,
    company: app.company,
    roleTitle: app.roleTitle,
    status: app.status,
    dateApplied: app.dateApplied,
    interviewDate: app.interviewDate,
  };
}

export function getBriefingWindow(
  previousBriefingCreatedAt: string | null,
  now: Date,
): { start: Date; end: Date } {
  const end = now;
  if (previousBriefingCreatedAt) {
    const start = parseDate(previousBriefingCreatedAt);
    if (start) return { start, end };
  }
  const start = new Date(now);
  start.setDate(start.getDate() - 1);
  return { start, end };
}

export function aggregateBriefingData(
  db: Db,
  userId: string,
  now: Date = new Date(),
): BriefingData {
  const briefingDate = toBriefingDate(now);

  const previousRows = db
    .select()
    .from(dailyBriefings)
    .where(
      and(
        eq(dailyBriefings.userId, userId),
        sql`${dailyBriefings.briefingDate} < ${briefingDate}`,
      ),
    )
    .orderBy(desc(dailyBriefings.briefingDate))
    .limit(1)
    .all();

  const previousBriefing = previousRows[0] ?? null;
  const { start, end } = getBriefingWindow(
    previousBriefing?.createdAt ?? null,
    now,
  );

  const userRows = db.select().from(users).where(eq(users.id, userId)).all();
  const userEmail = userRows[0]?.email?.toLowerCase() ?? '';

  const apps = db
    .select()
    .from(applications)
    .where(eq(applications.userId, userId))
    .all();

  const userContacts = db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, userId))
    .all();

  const contactEmails = new Set(
    userContacts
      .map((c) => c.email.trim().toLowerCase())
      .filter(Boolean),
  );

  const comms = db
    .select()
    .from(communications)
    .where(eq(communications.userId, userId))
    .all();

  const inboundComms = comms.filter(
    (c) =>
      c.direction === 'inbound' && isInWindow(c.occurredAt, start, end),
  );

  const inboundEmailRows = db.select().from(inboundEmails).all();
  const matchedInboundEmails = inboundEmailRows.filter((email) => {
    if (!isInWindow(email.receivedAt, start, end)) return false;
    const to = email.toEmail.toLowerCase();
    const from = email.fromEmail.toLowerCase();
    if (userEmail && (to.includes(userEmail) || from === userEmail)) {
      return true;
    }
    if (contactEmails.has(from)) return true;
    return false;
  });

  const newRecruiterEmails = [
    ...inboundComms.map((c) => ({
      id: c.id,
      subject: c.subject,
      fromEmail: '',
      receivedAt: c.occurredAt,
      source: 'communication' as const,
    })),
    ...matchedInboundEmails.map((e) => ({
      id: e.id,
      subject: e.subject,
      fromEmail: e.fromEmail,
      receivedAt: e.receivedAt,
      source: 'inbound_email' as const,
    })),
  ].sort(
    (a, b) =>
      new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );

  const overnightCutoff = new Date(now);
  overnightCutoff.setHours(overnightCutoff.getHours() - OVERNIGHT_HOURS);

  const recruiterResponsesOvernight = newRecruiterEmails.filter((e) => {
    const received = parseDate(e.receivedAt);
    return received !== null && received >= overnightCutoff && received <= now;
  });

  const applicationsSubmitted = apps
    .filter(
      (app) =>
        app.dateApplied &&
        isInWindow(`${app.dateApplied}T12:00:00.000Z`, start, end),
    )
    .map(toAppRef);

  const interviewInvitations = apps
    .filter(
      (app) =>
        app.interviewDate &&
        isInWindow(app.updatedAt, start, end) &&
        (app.status === 'interviewing' || app.status === 'final_round'),
    )
    .map(toAppRef);

  const interviewRows = db
    .select()
    .from(interviews)
    .where(eq(interviews.userId, userId))
    .all();

  const upcomingInterviews = interviewRows
    .filter((iv) => {
      const scheduled = parseDate(iv.scheduledAt);
      if (!scheduled) return false;
      const daysUntil = daysBetween(now, scheduled);
      return daysUntil >= 0 && daysUntil <= 14;
    })
    .map((iv) => {
      const app = apps.find((a) => a.id === iv.applicationId);
      return {
        id: iv.id,
        applicationId: iv.applicationId,
        company: app?.company ?? 'Unknown',
        roleTitle: app?.roleTitle ?? '',
        scheduledAt: iv.scheduledAt,
        type: iv.type,
      };
    })
    .sort(
      (a, b) =>
        new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    );

  const followUpNeeded = apps
    .filter((app) => ACTIVE_STATUSES.has(app.status))
    .flatMap((app) => {
      const reasons: {
        applicationId: string;
        company: string;
        roleTitle: string;
        reason: string;
      }[] = [];
      const appContacts = userContacts.filter((c) => c.applicationId === app.id);
      const lastContactDates = appContacts
        .map((c) => parseDate(c.lastContactDate))
        .filter((d): d is Date => d !== null);
      const lastContact =
        lastContactDates.length > 0
          ? new Date(Math.max(...lastContactDates.map((d) => d.getTime())))
          : null;

      if (app.status === 'applied' && app.dateApplied) {
        const applied = parseDate(app.dateApplied);
        if (applied && daysBetween(applied, now) >= 7 && !lastContact) {
          reasons.push({
            applicationId: app.id,
            company: app.company,
            roleTitle: app.roleTitle,
            reason: 'Applied 7+ days ago with no recruiter contact logged',
          });
        }
      }

      if (app.status === 'recruiter_screen' && lastContact) {
        const daysSince = daysBetween(lastContact, now);
        if (daysSince >= 3) {
          reasons.push({
            applicationId: app.id,
            company: app.company,
            roleTitle: app.roleTitle,
            reason: `No recruiter reply in ${daysSince} days`,
          });
        }
      }

      return reasons;
    });

  const inactiveApplications = apps
    .filter((app) => ACTIVE_STATUSES.has(app.status))
    .filter((app) => {
      const updated = parseDate(app.updatedAt);
      if (!updated) return false;
      return daysBetween(updated, now) >= INACTIVE_DAYS;
    })
    .map(toAppRef);

  const newOpportunities = apps
    .filter(
      (app) =>
        app.status === 'saved' && isInWindow(app.createdAt, start, end),
    )
    .map(toAppRef);

  const pipelineStats = computePipelineStats(apps);

  const changesSincePrevious: string[] = [];
  if (previousBriefing) {
    try {
      const prevData = JSON.parse(previousBriefing.dataJson) as BriefingData;
      const prevTotal = prevData.pipelineStats?.total ?? 0;
      if (pipelineStats.total !== prevTotal) {
        changesSincePrevious.push(
          `Pipeline size changed from ${prevTotal} to ${pipelineStats.total} applications`,
        );
      }
      if (applicationsSubmitted.length > 0) {
        changesSincePrevious.push(
          `${applicationsSubmitted.length} new application(s) submitted`,
        );
      }
      if (newRecruiterEmails.length > 0) {
        changesSincePrevious.push(
          `${newRecruiterEmails.length} new recruiter email(s) received`,
        );
      }
      if (upcomingInterviews.length > (prevData.upcomingInterviews?.length ?? 0)) {
        changesSincePrevious.push('New upcoming interview(s) scheduled');
      }
    } catch {
      changesSincePrevious.push('First detailed comparison unavailable');
    }
  } else {
    changesSincePrevious.push('First daily briefing for this account');
  }

  const recommendations = buildRuleBasedRecommendations({
    followUpNeeded,
    upcomingInterviews,
    inactiveApplications,
    newRecruiterEmails,
    applicationsSubmitted,
  });

  return {
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    briefingDate,
    pipelineStats,
    newRecruiterEmails,
    applicationsSubmitted,
    interviewInvitations,
    upcomingInterviews,
    followUpNeeded,
    inactiveApplications,
    recruiterResponsesOvernight,
    newOpportunities,
    recommendations,
    changesSincePrevious,
  };
}

function buildRuleBasedRecommendations(input: {
  followUpNeeded: BriefingData['followUpNeeded'];
  upcomingInterviews: BriefingData['upcomingInterviews'];
  inactiveApplications: BriefingData['inactiveApplications'];
  newRecruiterEmails: BriefingData['newRecruiterEmails'];
  applicationsSubmitted: BriefingData['applicationsSubmitted'];
}): string[] {
  const recs: string[] = [];

  for (const item of input.followUpNeeded.slice(0, 3)) {
    recs.push(`Follow up with ${item.company} (${item.roleTitle}): ${item.reason}`);
  }

  for (const iv of input.upcomingInterviews.slice(0, 2)) {
    recs.push(
      `Prepare for ${iv.company} interview (${iv.roleTitle}) on ${iv.scheduledAt.slice(0, 10)}`,
    );
  }

  if (input.newRecruiterEmails.length > 0) {
    recs.push(
      `Review ${input.newRecruiterEmails.length} new recruiter email(s) and log responses in communications`,
    );
  }

  if (input.inactiveApplications.length > 0) {
    recs.push(
      `Review ${input.inactiveApplications.length} inactive application(s) — archive or take action`,
    );
  }

  if (input.applicationsSubmitted.length > 0) {
    recs.push(
      `Track outcomes for ${input.applicationsSubmitted.length} application(s) submitted recently`,
    );
  }

  if (recs.length === 0) {
    recs.push(
      'No urgent actions detected. Consider sourcing new roles or networking outreach.',
    );
  }

  return recs;
}

export function diffPipelineStats(
  current: BriefingPipelineStats,
  previous: BriefingPipelineStats | undefined,
): string[] {
  if (!previous) return [];
  const changes: string[] = [];
  for (const status of new Set([
    ...Object.keys(current.byStatus),
    ...Object.keys(previous.byStatus),
  ])) {
    const cur = current.byStatus[status] ?? 0;
    const prev = previous.byStatus[status] ?? 0;
    if (cur !== prev) {
      changes.push(`${status}: ${prev} → ${cur}`);
    }
  }
  return changes;
}
