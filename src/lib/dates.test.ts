import { formatDate, parseDate } from './dates';

describe('parseDate / formatDate — date-only strings render the correct calendar day', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('formats a date-only string as "Jul 7" under a west-of-UTC timezone', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(formatDate('2026-07-07')).toBe('Jul 7, 2026');
  });

  it('formats the same date-only string as "Jul 7" under UTC', () => {
    process.env.TZ = 'UTC';
    expect(formatDate('2026-07-07')).toBe('Jul 7, 2026');
  });

  it('formats the same date-only string as "Jul 7" under an east-of-UTC timezone', () => {
    process.env.TZ = 'Asia/Tokyo';
    expect(formatDate('2026-07-07')).toBe('Jul 7, 2026');
  });

  it('parseDate returns a local-midnight Date for a date-only string, not UTC midnight', () => {
    process.env.TZ = 'America/Los_Angeles';
    const date = parseDate('2026-07-07');
    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(6); // 0-indexed: July
    expect(date?.getDate()).toBe(7);
    expect(date?.getHours()).toBe(0);
  });

  it('does not change how full ISO timestamps (with time) are parsed/formatted', () => {
    process.env.TZ = 'UTC';
    const iso = '2026-07-07T18:00:00.000Z';
    const date = parseDate(iso);
    expect(date?.toISOString()).toBe(iso);
    // A timestamp is a real instant, so its displayed calendar day is expected
    // to vary by timezone — unlike a bare date-only string, which must not.
    expect(formatDate(iso)).toBe('Jul 7, 2026');
  });

  it('returns null for invalid input, unchanged', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('not-a-date')).toBeNull();
    expect(formatDate(null)).toBe('—');
  });
});
