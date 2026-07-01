import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { dailyBriefings, users } from '../db/schema.js';
import { aggregateBriefingData } from './briefingAggregator.js';
import { sendBriefingEmail } from './briefingEmail.js';
import {
  parseBriefingData,
  toBriefingDate,
  type BriefingData,
  type DailyBriefingRecord,
} from './briefingTypes.js';
import {
  buildFallbackSummary,
  generateLlmCompletion,
  isLlmConfigured,
} from './llmClient.js';
import { createId, nowIso } from './id.js';

const SYSTEM_PROMPT = `You are an executive assistant for a job seeker. Write a concise daily executive briefing (3-5 short paragraphs max) based on the structured data provided. Cover: job search goal progress (daily/weekly/monthly targets and streaks), pipeline health, new recruiter activity, applications submitted, upcoming interviews, follow-ups needed, and top recommended actions. Include congratulatory messages for streaks and highlight when falling behind on goals. Be direct, actionable, and encouraging. Do not invent facts not present in the data.`;

function rowToRecord(row: typeof dailyBriefings.$inferSelect): DailyBriefingRecord {
  return {
    id: row.id,
    userId: row.userId,
    briefingDate: row.briefingDate,
    aiSummary: row.aiSummary,
    data: parseBriefingData(row.dataJson),
    status: row.status as 'completed' | 'failed',
    emailSentAt: row.emailSentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function getLatestBriefing(
  db: Db,
  userId: string,
): DailyBriefingRecord | null {
  const rows = db
    .select()
    .from(dailyBriefings)
    .where(eq(dailyBriefings.userId, userId))
    .orderBy(desc(dailyBriefings.briefingDate))
    .limit(1)
    .all();
  return rows[0] ? rowToRecord(rows[0]) : null;
}

export function getBriefingById(
  db: Db,
  userId: string,
  id: string,
): DailyBriefingRecord | null {
  const rows = db
    .select()
    .from(dailyBriefings)
    .where(and(eq(dailyBriefings.id, id), eq(dailyBriefings.userId, userId)))
    .limit(1)
    .all();
  return rows[0] ? rowToRecord(rows[0]) : null;
}

export function listBriefings(
  db: Db,
  userId: string,
  limit = 30,
): DailyBriefingRecord[] {
  const rows = db
    .select()
    .from(dailyBriefings)
    .where(eq(dailyBriefings.userId, userId))
    .orderBy(desc(dailyBriefings.briefingDate))
    .limit(limit)
    .all();
  return rows.map(rowToRecord);
}

export function getBriefingForDate(
  db: Db,
  userId: string,
  briefingDate: string,
): DailyBriefingRecord | null {
  const rows = db
    .select()
    .from(dailyBriefings)
    .where(
      and(
        eq(dailyBriefings.userId, userId),
        eq(dailyBriefings.briefingDate, briefingDate),
      ),
    )
    .limit(1)
    .all();
  return rows[0] ? rowToRecord(rows[0]) : null;
}

async function generateAiSummary(data: BriefingData): Promise<string> {
  const fallback = buildFallbackSummary(data);

  if (!isLlmConfigured()) {
    return fallback;
  }

  try {
    const aiSummary = await generateLlmCompletion({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: JSON.stringify(data, null, 2),
    });
    return aiSummary ?? fallback;
  } catch (err) {
    console.error('[daily-briefing] LLM generation failed, using fallback', err);
    return fallback;
  }
}

export async function generateDailyBriefingForUser(
  db: Db,
  userId: string,
  now: Date = new Date(),
  options: { force?: boolean; sendEmail?: boolean } = {},
): Promise<DailyBriefingRecord | null> {
  const briefingDate = toBriefingDate(now);

  if (!options.force) {
    const existing = getBriefingForDate(db, userId, briefingDate);
    if (existing) {
      return existing;
    }
  }

  const timestamp = nowIso();
  let data: BriefingData;
  let aiSummary: string;
  let status: 'completed' | 'failed' = 'completed';

  try {
    data = aggregateBriefingData(db, userId, now);
    aiSummary = await generateAiSummary(data);
  } catch (err) {
    console.error('[daily-briefing] Failed to generate briefing for user', {
      userId,
      err,
    });
    status = 'failed';
    data = {
      windowStart: '',
      windowEnd: timestamp,
      briefingDate,
      pipelineStats: {
        total: 0,
        byStatus: {},
        active: 0,
        offers: 0,
        rejected: 0,
        ghosted: 0,
      },
      newRecruiterEmails: [],
      applicationsSubmitted: [],
      interviewInvitations: [],
      upcomingInterviews: [],
      followUpNeeded: [],
      inactiveApplications: [],
      recruiterResponsesOvernight: [],
      newOpportunities: [],
      recommendations: [
        'Review your pipeline manually — briefing generation encountered an error',
      ],
      changesSincePrevious: [],
    };
    aiSummary = 'Briefing generation failed. Please try again later.';
  }

  const emailSentAt =
    options.sendEmail && status === 'completed'
      ? await trySendBriefingEmail(db, userId, briefingDate, aiSummary, data)
      : null;

  if (options.force) {
    const existing = getBriefingForDate(db, userId, briefingDate);
    if (existing) {
      db.update(dailyBriefings)
        .set({
          aiSummary,
          dataJson: JSON.stringify(data),
          status,
          emailSentAt: emailSentAt ?? existing.emailSentAt,
          updatedAt: timestamp,
        })
        .where(eq(dailyBriefings.id, existing.id))
        .run();
      return getBriefingById(db, userId, existing.id);
    }
  }

  const id = createId();
  db.insert(dailyBriefings)
    .values({
      id,
      userId,
      briefingDate,
      aiSummary,
      dataJson: JSON.stringify(data),
      status,
      emailSentAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  return getBriefingById(db, userId, id);
}

async function trySendBriefingEmail(
  db: Db,
  userId: string,
  briefingDate: string,
  aiSummary: string,
  data: BriefingData,
): Promise<string | null> {
  if (process.env.DAILY_BRIEFING_EMAIL_ENABLED !== 'true') {
    return null;
  }

  const userRows = db.select().from(users).where(eq(users.id, userId)).all();
  const user = userRows[0];
  if (!user?.email) return null;

  try {
    await sendBriefingEmail({
      to: user.email,
      name: user.name,
      briefingDate,
      aiSummary,
      recommendations: data.recommendations,
    });
    return nowIso();
  } catch (err) {
    console.error('[daily-briefing] Email delivery failed for user', {
      userId,
      err,
    });
    return null;
  }
}

export async function generateDailyBriefingsForAllUsers(
  db: Db,
  now: Date = new Date(),
): Promise<{ generated: number; skipped: number; failed: number }> {
  const allUsers = db.select({ id: users.id }).from(users).all();
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const { id: userId } of allUsers) {
    try {
      const briefingDate = toBriefingDate(now);
      const existing = getBriefingForDate(db, userId, briefingDate);
      if (existing) {
        skipped += 1;
        continue;
      }

      const result = await generateDailyBriefingForUser(db, userId, now, {
        sendEmail: true,
      });
      if (result?.status === 'failed') {
        failed += 1;
      } else if (result) {
        generated += 1;
      }
    } catch (err) {
      failed += 1;
      console.error('[daily-briefing] Isolated failure for user', { userId, err });
    }
  }

  return { generated, skipped, failed };
}
