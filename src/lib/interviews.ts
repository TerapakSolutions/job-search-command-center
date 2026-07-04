import type { Interview } from '../types/interview';

/**
 * The soonest not-yet-past interview instant for an application, or null.
 * Used to show a real time-of-day where the application record itself only
 * carries a date-only `interviewDate` field.
 */
export function upcomingInterviewAt(
  interviews: Interview[],
  applicationId: string,
  now: Date = new Date(),
): string | null {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const upcoming = interviews
    .filter((interview) => interview.applicationId === applicationId)
    .map((interview) => ({
      raw: interview.scheduledAt,
      time: new Date(interview.scheduledAt).getTime(),
    }))
    .filter((entry) => !Number.isNaN(entry.time) && entry.time >= startOfToday.getTime())
    .sort((a, b) => a.time - b.time);

  return upcoming[0]?.raw ?? null;
}
