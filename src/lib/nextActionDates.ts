/**
 * Finds explicit calendar dates in free-text next actions, so a next action
 * whose dates have all passed can be shown as out of date instead of as a live
 * to-do. Pure: "now" is always passed in, never read from the clock.
 *
 * Recognised formats (English, case-insensitive):
 *   - "March 4, 2031", "Mar 4, 2031", "Mar. 4th 2031", "Sept 9 2031"
 *   - "March 4" / "Mar 4" with no year (see year inference below)
 *   - "3/4/2031" (US month/day order, four-digit year only)
 *   - "2031-03-04"
 *
 * Deliberately NOT recognised (the text stays live):
 *   - relative phrases: "tomorrow", "next week", "this Friday", "in 2 weeks"
 *   - bare "3/4" and two-digit years ("3/4/31"): too ambiguous
 *   - day-first forms ("4 March"), ranges beyond their first day
 *     ("Mar 4-5" yields only Mar 4)
 *   - impossible dates (Feb 30, Apr 31, Feb 29 in a non-leap year)
 *
 * Year inference for a month-name date with no year: assume the current year.
 * If that lands more than 183 days (~6 months) after today, use the previous
 * year; if it lands more than 183 days before today, use the next year. So on
 * Mar 9 "Mar 4" means five days ago, and on Dec 10 "Jan 5" means next month.
 */

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const MONTH_NAME_RE =
  /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?/gi;
const NUMERIC_RE = /(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{4})(?![\d/])/g;
const ISO_RE = /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g;

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_INFERENCE_WINDOW_DAYS = 183;

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function dayNumber(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function todayOf(now: Date): CalendarDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function inferYear(month: number, day: number, today: CalendarDate): number {
  const diff =
    dayNumber(today.year, month, day) - dayNumber(today.year, today.month, today.day);
  if (diff > YEAR_INFERENCE_WINDOW_DAYS) return today.year - 1;
  if (diff < -YEAR_INFERENCE_WINDOW_DAYS) return today.year + 1;
  return today.year;
}

/** Every valid explicit date in `text`, in the order they appear. */
export function findExplicitDates(text: string, now: Date): CalendarDate[] {
  const today = todayOf(now);
  const found: Array<{ index: number; date: CalendarDate }> = [];
  const push = (index: number, year: number, month: number, day: number) => {
    if (isValidDate(year, month, day)) found.push({ index, date: { year, month, day } });
  };

  for (const m of text.matchAll(MONTH_NAME_RE)) {
    const month = MONTHS[m[1].toLowerCase()];
    const day = Number(m[2]);
    const year = m[3] ? Number(m[3]) : inferYear(month, day, today);
    push(m.index ?? 0, year, month, day);
  }
  for (const m of text.matchAll(NUMERIC_RE)) {
    push(m.index ?? 0, Number(m[3]), Number(m[1]), Number(m[2]));
  }
  for (const m of text.matchAll(ISO_RE)) {
    push(m.index ?? 0, Number(m[1]), Number(m[2]), Number(m[3]));
  }

  return found.sort((a, b) => a.index - b.index).map((f) => f.date);
}

/**
 * True only when the text names at least one explicit date and EVERY date it
 * names is before today (the local calendar day of `now`). Today is not past.
 * Text with no parseable date is never past.
 */
export function isNextActionDatePast(text: string, now: Date): boolean {
  const dates = findExplicitDates(text, now);
  if (dates.length === 0) return false;
  const t = todayOf(now);
  const todayN = dayNumber(t.year, t.month, t.day);
  return dates.every((d) => dayNumber(d.year, d.month, d.day) < todayN);
}

/**
 * Default number of BUSINESS days (Mon-Fri) after a past EVENT (a next action
 * naming one of FOLLOW_UP_EVENT_WORDS) that its follow-up is due. The user can
 * change it in Settings, within FOLLOW_UP_AFTER_DAYS_MIN..MAX; a stored null
 * means this default. A missed deadline (no event word) gets no grace: it is
 * overdue from its own date. The one place this lives on the client.
 */
export const FOLLOW_UP_AFTER_DAYS = 3;
export const FOLLOW_UP_AFTER_DAYS_MIN = 1;
export const FOLLOW_UP_AFTER_DAYS_MAX = 14;

/** True for a whole number of business days the setting allows. */
export function isValidFollowUpAfterDays(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= FOLLOW_UP_AFTER_DAYS_MIN &&
    value <= FOLLOW_UP_AFTER_DAYS_MAX
  );
}

/**
 * Event words that let the lead name what happened ("Follow up on the meeting
 * from Nov 13."). Matched as whole words, case-insensitive, with an optional
 * plural "s"; the FIRST one in the text wins. Deliberately simple, so
 * "callback" and "demonstrate" do NOT match and are read as deadlines. "call"
 * also matches the verb ("Call back on Nov 12"), which reads fine as "the call";
 * "screening" matches even in "Send the screening answers by ...".
 */
export const FOLLOW_UP_EVENT_WORDS = [
  'meeting',
  'interview',
  'call',
  'chat',
  'coffee',
  'onsite',
  'panel',
  'screening',
  'screen',
  'demo',
] as const;

const EVENT_RE = new RegExp(`\\b(${FOLLOW_UP_EVENT_WORDS.join('|')})s?\\b`, 'i');

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export interface FollowUp {
  /**
   * 'event': the text names one of FOLLOW_UP_EVENT_WORDS, so a follow-up is
   * due `afterDays` business days after it. 'deadline': no event word; it is
   * overdue from its own date (dueInDays is always negative).
   */
  kind: 'event' | 'deadline';
  /** Event: "Follow up on the meeting from Nov 13." Deadline: "Nov 13 has passed." */
  lead: string;
  /**
   * Event, in business days: "Follow-up due today" / "Follow-up due in N
   * business day(s)" / "Follow-up overdue by N business day(s)".
   * Deadline, in business days: "Overdue by N business day(s)".
   */
  status: string;
  /**
   * Local CALENDAR days until due (for an event, until its business-day due
   * date); 0 = today, negative = overdue. One measure for both kinds, so mixed
   * items sort together (most negative first). Its sign always matches status.
   * It never orders against the business-day counts in status: a business-day
   * count can only shrink as the date moves later (it may tie where calendar
   * days do not, e.g. a Fri and the Sat after it).
   */
  dueInDays: number;
}

function pluralBusiness(n: number): string {
  return `${n} business ${n === 1 ? 'day' : 'days'}`;
}

/*
 * Business days are Monday to Friday. There is NO holiday calendar: a public
 * holiday counts as a business day. Day numbers are UTC day counts (day 0,
 * Jan 1 1970, was a Thursday), so DST never shifts them.
 */
function isWeekend(n: number): boolean {
  const weekday = (((n % 7) + 7) % 7 + 4) % 7; // 0 = Sunday ... 6 = Saturday
  return weekday === 0 || weekday === 6;
}

/** n itself if it is a business day, else the next one (the Monday). */
function onOrNextBusinessDay(n: number): number {
  let d = n;
  while (isWeekend(d)) d += 1;
  return d;
}

/** Business days in the half-open range (from, to]. */
function businessDaysBetween(from: number, to: number): number {
  let count = 0;
  for (let d = from + 1; d <= to; d += 1) if (!isWeekend(d)) count += 1;
  return count;
}

/**
 * The follow-up due date for an event on day `n`: N business days after it.
 * An event on a weekend counts from the next business day (the Monday), so
 * Sat + 3 = Thu, the same as Mon + 3. Fri + 3 = Wed.
 */
function followUpDueDay(n: number, afterDays: number): number {
  let d = onOrNextBusinessDay(n);
  for (let left = afterDays; left > 0; ) {
    d += 1;
    if (!isWeekend(d)) left -= 1;
  }
  return d;
}

/**
 * For a past-dated next action (see isNextActionDatePast), what to show instead
 * of the stale text; null otherwise. Uses the LATEST date in the text (latest by
 * calendar, not by position).
 *
 * Event (the text names one): the follow-up is due `afterDays` business days
 * after that date (default FOLLOW_UP_AFTER_DAYS; an invalid value falls back to
 * it). Due/overdue are counted in business days:
 *   - "due today" only when today IS the due date, so never on a weekend;
 *   - "due in N" = business days after today up to and including the due date
 *     (seen on a Saturday, a Monday due date is "in 1");
 *   - "overdue by N" = business days after the due date up to and including
 *     today, where a weekend today counts as the coming Monday (a Friday due
 *     date is "overdue by 1" on Saturday, Sunday and Monday alike).
 * Deadline (no event word): due on the date itself and so already overdue,
 * counted in business days: those after the date up to and including today,
 * with a weekend today counting as the coming Monday (as for events). A weekend
 * deadline is not moved, so Sat -> Mon is overdue by 1 and Sat -> Tue by 2.
 * afterDays does not apply.
 *
 * Day arithmetic uses calendar day numbers, so DST changes and the time of day
 * do not shift it. Display only: the stored text is never changed.
 */
export function followUpFor(
  text: string,
  now: Date,
  afterDays: number = FOLLOW_UP_AFTER_DAYS,
): FollowUp | null {
  if (!isNextActionDatePast(text, now)) return null;
  const dates = findExplicitDates(text, now);
  const latest = dates.reduce((a, b) =>
    dayNumber(b.year, b.month, b.day) > dayNumber(a.year, a.month, a.day) ? b : a,
  );
  const label = `${SHORT_MONTHS[latest.month - 1]} ${latest.day}`;
  const event = EVENT_RE.exec(text)?.[1].toLowerCase();
  const t = todayOf(now);
  const dateN = dayNumber(latest.year, latest.month, latest.day);
  const todayN = dayNumber(t.year, t.month, t.day);

  if (!event) {
    const dueInDays = dateN - todayN; // always < 0: the date is past
    // The date is NOT moved to a business day, so the business day after a
    // weekend deadline is already overdue by 1; >= 1 whenever the date is past.
    const overdue = businessDaysBetween(dateN, onOrNextBusinessDay(todayN));
    return {
      kind: 'deadline',
      lead: `${label} has passed.`,
      status: `Overdue by ${pluralBusiness(overdue)}`,
      dueInDays,
    };
  }

  const lead = `Follow up on the ${event} from ${label}.`;
  const n = isValidFollowUpAfterDays(afterDays) ? afterDays : FOLLOW_UP_AFTER_DAYS;
  const dueN = followUpDueDay(dateN, n);
  const dueInDays = dueN - todayN;
  const status =
    dueInDays === 0
      ? 'Follow-up due today'
      : dueInDays > 0
        ? `Follow-up due in ${pluralBusiness(businessDaysBetween(todayN, dueN))}`
        : `Follow-up overdue by ${pluralBusiness(
            businessDaysBetween(dueN, onOrNextBusinessDay(todayN)),
          )}`;
  return { kind: 'event', lead, status, dueInDays };
}
