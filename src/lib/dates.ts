const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
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

export function todayIso(): string {
  return startOfDay(new Date()).toISOString();
}
