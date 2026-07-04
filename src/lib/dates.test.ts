import { formatDate, formatDateTime, parseDate } from './dates';

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

describe('formatDateTime — renders local time for full instants', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('renders a full ISO instant with local time (22:00Z = 3:00 PM Pacific)', () => {
    // Note: Intl caches the process default timezone after first use, so this
    // suite asserts one timezone only; TZ is set before any Intl call here.
    process.env.TZ = 'America/Los_Angeles';
    expect(formatDateTime('2026-07-07T22:00:00.000Z')).toBe('Jul 7, 2026, 3:00 PM');
  });

  it('falls back to date-only formatting for bare dates instead of fabricating midnight', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(formatDateTime('2026-07-07')).toBe('Jul 7, 2026');
  });

  it('handles null/invalid input', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
  });
});
