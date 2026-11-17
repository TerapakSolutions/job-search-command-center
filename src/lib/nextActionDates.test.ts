/** @jest-environment node */
import { findExplicitDates, isNextActionDatePast } from './nextActionDates';

// Every "now" is injected. Invented dates only; none of these refer to real events.
const NOW = new Date(2031, 1, 10, 9, 30); // Mon Feb 10, 2031, 9:30 local

describe('findExplicitDates — formats', () => {
  it.each([
    ['Call back on March 4, 2031 about the panel', { year: 2031, month: 3, day: 4 }],
    ['Call back on Mar 4, 2031', { year: 2031, month: 3, day: 4 }],
    ['Call back on Mar. 4th, 2031', { year: 2031, month: 3, day: 4 }],
    ['Call back on Sept 9 2031', { year: 2031, month: 9, day: 9 }],
    ['Call back on 3/4/2031', { year: 2031, month: 3, day: 4 }],
    ['Call back on 03/04/2031', { year: 2031, month: 3, day: 4 }],
    ['Call back on 2031-03-04', { year: 2031, month: 3, day: 4 }],
    ['Call back on MARCH 4', { year: 2031, month: 3, day: 4 }],
  ])('parses %p', (text, expected) => {
    expect(findExplicitDates(text, NOW)).toEqual([expected]);
  });

  it('finds every date in a sentence, in order', () => {
    expect(
      findExplicitDates('Pick a slot: Jan 28, 2031 or 2031-02-20', NOW),
    ).toEqual([
      { year: 2031, month: 1, day: 28 },
      { year: 2031, month: 2, day: 20 },
    ]);
  });

  it('does not read a month and year as a month and day ("Nov 2030" is not Nov 20)', () => {
    expect(findExplicitDates('Started talking in Nov 2030', NOW)).toEqual([]);
  });

  it('does not double-count an ISO date as a numeric date', () => {
    expect(findExplicitDates('Due 2031-03-04', NOW)).toHaveLength(1);
  });

  it('does not treat words like "may" or "Monday" as months', () => {
    expect(findExplicitDates('You may 2x check the Monday 3 pm slot', NOW)).toEqual([]);
  });

  it.each([
    'Reply tomorrow',
    'Follow up next week',
    'Send thank-you note this Friday',
    'Check back in 2 weeks',
    'Ask about 3/4', // bare M/D without a year is ambiguous — ignored
    'Ask about 3/4/31', // two-digit years are ignored
  ])('finds no date in relative or ambiguous text %p', (text) => {
    expect(findExplicitDates(text, NOW)).toEqual([]);
  });

  it.each([
    'Call on February 30, 2031',
    'Call on Feb 29, 2031', // 2031 is not a leap year
    'Call on 2/30/2031',
    'Call on 2031-13-01',
    'Call on April 31',
  ])('ignores the invalid date in %p', (text) => {
    expect(findExplicitDates(text, NOW)).toEqual([]);
  });

  it('accepts Feb 29 in a leap year', () => {
    expect(findExplicitDates('Call on Feb 29, 2032', NOW)).toEqual([
      { year: 2032, month: 2, day: 29 },
    ]);
  });
});

describe('findExplicitDates — year inference when the year is missing', () => {
  // Rule: assume the current year. If that lands MORE than 183 days after today,
  // use the previous year; if MORE than 183 days before today, use the next year.
  it('keeps the current year up to 183 days ahead (Feb 10 -> Aug 12 is 183 days)', () => {
    expect(findExplicitDates('Panel on Aug 12', NOW)).toEqual([
      { year: 2031, month: 8, day: 12 },
    ]);
  });

  it('uses the previous year once it would be more than 183 days ahead (Aug 13 is 184)', () => {
    expect(findExplicitDates('Panel on Aug 13', NOW)).toEqual([
      { year: 2030, month: 8, day: 13 },
    ]);
  });

  const LATE_YEAR = new Date(2031, 9, 20, 16, 0); // Oct 20, 2031

  it('keeps the current year up to 183 days behind (Apr 20 -> Oct 20 is 183 days)', () => {
    expect(findExplicitDates('Panel on April 20', LATE_YEAR)).toEqual([
      { year: 2031, month: 4, day: 20 },
    ]);
  });

  it('uses the next year once it would be more than 183 days behind (Apr 19 is 184)', () => {
    expect(findExplicitDates('Panel on April 19', LATE_YEAR)).toEqual([
      { year: 2032, month: 4, day: 19 },
    ]);
  });

  it('reads "Jan 5" written in December as next January', () => {
    const december = new Date(2031, 11, 10, 12, 0);
    expect(findExplicitDates('Kickoff Jan 5', december)).toEqual([
      { year: 2032, month: 1, day: 5 },
    ]);
  });
});

describe('isNextActionDatePast', () => {
  it('is past when the only date is before today', () => {
    expect(isNextActionDatePast('Confirm the panel on February 6, 2031', NOW)).toBe(true);
  });

  it('is past for a no-year date a few days ago', () => {
    expect(isNextActionDatePast('Confirm the panel on Feb 6', NOW)).toBe(true);
  });

  it('is NOT past when the date is today', () => {
    expect(isNextActionDatePast('Confirm the panel on February 10, 2031', NOW)).toBe(false);
  });

  it('is NOT past when the date is today, even late in the evening', () => {
    const lateEvening = new Date(2031, 1, 10, 23, 59);
    expect(isNextActionDatePast('Panel 2031-02-10', lateEvening)).toBe(false);
  });

  it('is past for yesterday', () => {
    expect(isNextActionDatePast('Panel 2/9/2031', NOW)).toBe(true);
  });

  it('is NOT past when any one of several dates is in the future', () => {
    expect(
      isNextActionDatePast('Missed Feb 3, 2031; rescheduled to Feb 24, 2031', NOW),
    ).toBe(false);
  });

  it('is past when every one of several dates is before today', () => {
    expect(isNextActionDatePast('Either Feb 3, 2031 or Feb 5, 2031', NOW)).toBe(true);
  });

  it('is NOT past when the text has no explicit date', () => {
    expect(isNextActionDatePast('Follow up next week', NOW)).toBe(false);
    expect(isNextActionDatePast('Send the portfolio link', NOW)).toBe(false);
  });

  it('is NOT past when the only date is invalid', () => {
    expect(isNextActionDatePast('Panel on Feb 30, 2030', NOW)).toBe(false);
  });
});
