const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Bare "YYYY-MM-DD" (no time component). The native `Date` constructor parses
// this form as UTC midnight, which then renders as the PREVIOUS calendar day
// for any timezone west of UTC once formatted locally. Full timestamps (with a
// time component and/or "Z"/offset) are unaffected and parsed as before.
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (DATE_ONLY_PATTERN.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function daysBetween(from: Date, to: Date): number {
  const fromDay = startOfDay(from).getTime();
  const toDay = startOfDay(to).getTime();
  return Math.floor((toDay - fromDay) / MS_PER_DAY);
}

export function addBusinessDays(from: Date, businessDays: number): Date {
  const result = new Date(from);
  let added = 0;
  while (added < businessDays) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) {
      added += 1;
    }
  }
  return result;
}

export function businessDaysBetween(from: Date, to: Date): number {
  let count = 0;
  const cursor = new Date(startOfDay(from));
  const end = startOfDay(to);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      count += 1;
    }
  }
  return count;
}

export function formatDate(value: string | null): string {
  const date = parseDate(value);
  if (!date) return '—';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Date + time in the viewer's local timezone. A bare date-only string has no
// time to show, so it falls back to formatDate rather than fabricating
// midnight.
export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  if (DATE_ONLY_PATTERN.test(value)) return formatDate(value);
  const date = parseDate(value);
  if (!date) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function todayIso(): string {
  return startOfDay(new Date()).toISOString();
}
