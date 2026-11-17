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
