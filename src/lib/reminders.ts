import type { Application } from '../types/application';
import type { Contact } from '../types/contact';
import type { Interview } from '../types/interview';
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

// Written into a contact's notes when a second vendor pitches a role you are
// already submitted to through another one (emailAutomationService).
const SECONDARY_VENDOR_NOTE = /\bSecondary vendor:/;

function normalizeVendor(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function belongsToAgency(contact: Contact, agency: string): boolean {
  const labels = (contact.email.split('@')[1] ?? '').split('.').slice(0, -1);
  return [contact.company, ...labels].some((v) => vendorKey(v) === agency);
}

/** A vendor name without its legal suffix, for whole-name comparison. */
function vendorKey(value: string | null | undefined): string {
  return normalizeVendor((value ?? '').replace(/[\s,]+(?:inc|llc|ltd|corp|co)\.?\s*$/i, ''));
}

/**
 * Known to work for a vendor other than the client. Email-created contacts often
 * carry the client's name as their company, and some carry none, so the data
 * can't always tell; anyone not clearly elsewhere counts as a client contact
 * (the rule with fewer false nudges).
 */
function isOtherVendor(contact: Contact, app: Application): boolean {
  const company = vendorKey(contact.company);
  const client = vendorKey(app.company);
  if (!company || !client) return false;
  if (company.includes(client) || client.includes(company)) return false;
  return !belongsToAgency(contact, client);
}

/**
 * Who the "Ping recruiter" nudge is for (targets) and whose contact restarts its
 * clock:
 *   - a closed thread (you confirmed) and a declined one (Today asks to close it
 *     instead) never count;
 *   - a secondary vendor (you are represented by another one) doesn't count,
 *     unless you kept the thread open;
 *   - when the application names the vendor you are represented by (agency) and
 *     has a contact there, only that vendor's dated contacts are targets, and
 *     another vendor doesn't restart the clock, while a client contact does. If
 *     all of the agency's are closed, nobody is pinged; if an open one has no
 *     date to time from, the other open contacts count as before.
 */
function nudgeContacts(
  app: Application,
  appContacts: Contact[],
): { targets: Contact[]; clock: Contact[] } {
  const eligible = appContacts.filter(
    (c) => c.threadKeptOpenAt || !SECONDARY_VENDOR_NOTE.test(c.messageNotes),
  );
  const open = eligible.filter((c) => !c.threadClosedAt && !c.declineDetectedAt);
  const agency = vendorKey(app.agency);
  if (!agency) return { targets: open, clock: open };
  const theirs = eligible.filter((c) => belongsToAgency(c, agency));
  const theirsOpen = theirs.filter((c) => open.includes(c));
  if (theirs.length > 0 && theirsOpen.length === 0) return { targets: [], clock: [] };
  const dated = theirsOpen.filter((c) => parseDate(c.lastContactDate));
  if (dated.length === 0) return { targets: open, clock: open };
  return { targets: dated, clock: open.filter((c) => dated.includes(c) || !isOtherVendor(c, app)) };
}

/** The vendor a declined contact works for: its company, else its email domain, else its name. */
function vendorLabel(app: Application, contact: Contact): string {
  const company = contact.company.trim();
  if (company && company.toLowerCase() !== app.company.trim().toLowerCase()) return company;
  return contact.email.split('@')[1]?.trim() || contact.name;
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * "I followed up": the contact's new last-contact date, the local calendar day
 * of the click, or null when the stored date is already that day or later
 * (never moves it backwards).
 */
export function followedUpContactDate(lastContactDate: string | null, now: Date): string | null {
  const today = localDay(now);
  return lastContactDate && lastContactDate.slice(0, 10) >= today ? null : today;
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

/** This application's meeting times, unparseable ones dropped. */
export function meetingTimes(interviews: Interview[], applicationId: string): Date[] {
  return interviews
    .filter((interview) => interview.applicationId === applicationId)
    .map((interview) => new Date(interview.scheduledAt))
    .filter((at) => !Number.isNaN(at.getTime()));
}

/** The latest of a date and a list of dates, or null when there is none. */
export function latestOf(first: Date | null, rest: Date[]): Date | null {
  let latest = first;
  for (const at of rest) if (!latest || at > latest) latest = at;
  return latest;
}

// True when the application has interviews scheduled on `day` and every one
// of them has already started, i.e. there is nothing left to prep for.
function interviewsOnDayAreOver(
  interviews: Interview[],
  applicationId: string,
  day: Date,
  now: Date,
): boolean {
  const onDay = interviews.filter((interview) => {
    if (interview.applicationId !== applicationId) return false;
    const at = new Date(interview.scheduledAt);
    return !Number.isNaN(at.getTime()) && startOfDay(at).getTime() === day.getTime();
  });
  return onDay.length > 0 && onDay.every((interview) => new Date(interview.scheduledAt) <= now);
}

export function computeReminders(
  applications: Application[],
  contacts: Contact[],
  now = new Date(),
  interviews: Interview[] = [],
): Reminder[] {
  const reminders: Reminder[] = [];
  const today = startOfDay(now);

  for (const app of applications) {
    if (!ACTIVE_STATUSES.has(app.status)) continue;

    const allAppContacts = getContactsForApplication(contacts, app.id);

    // A decline you sent: ask to close that thread (never closed silently).
    for (const c of allAppContacts) {
      if (!c.declineDetectedAt || c.threadClosedAt) continue;
      reminders.push({
        id: `close_thread-${c.id}`,
        type: 'close_thread',
        priority: 'medium',
        title: `Close thread: ${app.company} via ${vendorLabel(app, c)} (you declined)?`,
        description: `You declined this role with ${c.name}. Close the thread to stop reminders for it.`,
        applicationId: app.id,
        contactId: c.id,
        dueDate: today.toISOString(),
      });
    }

    const { targets, clock } = nudgeContacts(app, allAppContacts);
    const lastContact = latestContactDate(clock);

    // No reminders for a plain application (applied, waiting): there is
    // nothing to act on until a recruiter is involved (Steve, 2026-10-26).

    // A meeting is recruiter contact too (Steve, 2026-11-16: pinged the Monday after a Friday meeting).
    // A booked one means there is nothing to chase; a held one restarts the clock.
    const meetings = meetingTimes(interviews, app.id);
    const meetingBooked = meetings.some((at) => at > now);
    const lastTouch = latestOf(lastContact, meetings.filter((at) => at <= now));

    if (app.status === 'recruiter_screen' && lastContact && lastTouch && !meetingBooked) {
      const businessDaysSince = businessDaysBetween(lastTouch, today);
      if (businessDaysSince >= 3) {
        const recruiter =
          targets.find(
            (c) => parseDate(c.lastContactDate)?.getTime() === latestContactDate(targets)?.getTime(),
          ) ?? targets[0];
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
        const over = interviewsOnDayAreOver(interviews, app.id, startOfDay(interviewDate), now);
        if (daysUntil >= 0 && daysUntil <= 3 && !over) {
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
    if (app.status === 'saved' && daysSinceActivity >= 30) {
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
