import type { Application } from '../types/application';
import type { Contact } from '../types/contact';
import type { Reminder } from '../types/reminder';
import {
  addBusinessDays,
  businessDaysBetween,
  daysBetween,
  parseDate,
  startOfDay,
} from './dates';

const ACTIVE_STATUSES = new Set([
  'saved',
  'applied',
  'recruiter_screen',
  'interviewing',
  'final_round',
]);

function getContactsForApplication(contacts: Contact[], applicationId: string): Contact[] {
  return contacts.filter((c) => c.applicationId === applicationId);
}

function latestContactDate(contacts: Contact[]): Date | null {
  let latest: Date | null = null;
  for (const contact of contacts) {
    const date = parseDate(contact.lastContactDate);
    if (date && (!latest || date > latest)) {
      latest = date;
    }
  }
  return latest;
}

export function computeReminders(
  applications: Application[],
  contacts: Contact[],
  now = new Date(),
): Reminder[] {
  const reminders: Reminder[] = [];
  const today = startOfDay(now);

  for (const app of applications) {
    if (!ACTIVE_STATUSES.has(app.status)) continue;

    const appContacts = getContactsForApplication(contacts, app.id);
    const lastContact = latestContactDate(appContacts);

    if (app.status === 'applied' && app.dateApplied) {
      const appliedDate = parseDate(app.dateApplied);
      if (appliedDate && daysBetween(appliedDate, today) >= 7 && !lastContact) {
        reminders.push({
          id: `follow_up_applied-${app.id}`,
          type: 'follow_up_applied',
          priority: 'high',
          title: `Follow up: ${app.company}`,
          description: `Applied ${daysBetween(appliedDate, today)} days ago with no recruiter contact logged.`,
          applicationId: app.id,
          dueDate: today.toISOString(),
        });
      }
    }

    if (app.status === 'recruiter_screen' && lastContact) {
      const businessDaysSince = businessDaysBetween(lastContact, today);
      if (businessDaysSince >= 3) {
        const recruiter =
          appContacts.find((c) => parseDate(c.lastContactDate)?.getTime() === lastContact.getTime()) ??
          appContacts[0];
        reminders.push({
          id: `recruiter_no_reply-${app.id}`,
          type: 'recruiter_no_reply',
          priority: 'high',
          title: `Ping recruiter: ${app.company}`,
          description: `No reply in ${businessDaysSince} business days${recruiter ? ` (${recruiter.name})` : ''}.`,
          applicationId: app.id,
          contactId: recruiter?.id,
          dueDate: today.toISOString(),
        });
      }
    }

    if (
      (app.status === 'interviewing' || app.status === 'final_round') &&
      app.interviewDate
    ) {
      const interviewDate = parseDate(app.interviewDate);
      if (interviewDate) {
        const daysUntil = daysBetween(today, interviewDate);
        if (daysUntil >= 0 && daysUntil <= 3) {
          reminders.push({
            id: `interview_prep-${app.id}`,
            type: 'interview_prep',
            priority: daysUntil <= 1 ? 'high' : 'medium',
            title: `Prep for interview: ${app.company}`,
            description:
              daysUntil === 0
                ? 'Interview is today.'
                : daysUntil === 1
                  ? 'Interview is tomorrow.'
                  : `Interview in ${daysUntil} days.`,
            applicationId: app.id,
            dueDate: today.toISOString(),
          });
        }
      }
    }

    const referenceDate =
      parseDate(app.dateApplied) ?? parseDate(app.createdAt);
    const daysSinceActivity = referenceDate
      ? daysBetween(referenceDate, today)
      : 0;
    const hasRecentContact =
      lastContact && daysBetween(lastContact, today) < 14;

    if (
      (app.status === 'saved' && daysSinceActivity >= 30) ||
      (app.status === 'applied' && daysSinceActivity >= 30 && !hasRecentContact)
    ) {
      reminders.push({
        id: `stale_review-${app.id}`,
        type: 'stale_review',
        priority: 'low',
        title: `Review stale: ${app.company}`,
        description: `No meaningful activity in ${daysSinceActivity}+ days. Consider archiving or taking action.`,
        applicationId: app.id,
        dueDate: today.toISOString(),
      });
    }
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return reminders.sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );
}

export function getNextRecruiterFollowUpDate(lastContactDate: string): string {
  const date = parseDate(lastContactDate);
  if (!date) return '';
  return addBusinessDays(date, 3).toISOString().slice(0, 10);
}
