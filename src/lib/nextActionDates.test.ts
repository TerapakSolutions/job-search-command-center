/** @jest-environment node */
import {
  findExplicitDates,
  FOLLOW_UP_AFTER_DAYS,
  followUpFor,
  isNextActionDatePast,
} from './nextActionDates';

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

describe('followUpFor — a past-dated action becomes a follow-up', () => {
  // Invented events. NOW_F is Tue Nov 17, 2026, 9:00 local.
  const NOW_F = new Date(2026, 10, 17, 9, 0);

  it('uses FOLLOW_UP_AFTER_DAYS = 3', () => {
    expect(FOLLOW_UP_AFTER_DAYS).toBe(3);
  });

  it('returns null for undated, future-dated and today-dated text', () => {
    expect(followUpFor('Send the portfolio link', NOW_F)).toBeNull();
    expect(followUpFor('Prepare for the panel on Nov 20', NOW_F)).toBeNull();
    expect(followUpFor('Call at noon on Nov 17', NOW_F)).toBeNull();
    // One date past, one still ahead: not past-dated, so no follow-up.
    expect(followUpFor('Meeting on Nov 10 or Nov 24', NOW_F)).toBeNull();
  });

  it('names the event when the text names one', () => {
    expect(
      followUpFor('Confirm attendance for the meeting on Nov 13.', NOW_F)?.lead,
    ).toBe('Follow up on the meeting from Nov 13.');
  });

  it.each([
    ['Confirm the onsite for Nov 12', 'onsite'],
    ['Prep for the Interview on November 12, 2026', 'interview'],
    ['Phone screen with the hiring lead on 11/12/2026', 'screen'],
    ['Screening with the hiring lead on Nov 12', 'screening'],
    ['Two screenings on Nov 12', 'screening'],
    ['Coffee with the team lead 2026-11-12', 'coffee'],
    ['Product demos on Nov 12', 'demo'],
    ['Quick chat on Nov 12', 'chat'],
    ['Panel on Nov 12', 'panel'],
    ['Call back on Nov 12', 'call'],
  ])('detects the event in %p', (text, event) => {
    expect(followUpFor(text, NOW_F)?.lead).toBe(`Follow up on the ${event} from Nov 12.`);
  });

  it('takes the first event word in the text', () => {
    expect(followUpFor('Coffee before the interview on Nov 12', NOW_F)?.lead).toBe(
      'Follow up on the coffee from Nov 12.',
    );
  });

  it.each([
    'Request a callback by Nov 12',
    'Demonstrate the prototype by Nov 12',
    'Send the deck by Nov 12',
  ])('uses the deadline lead when no event word is present: %p', (text) => {
    expect(followUpFor(text, NOW_F)?.lead).toBe('Nov 12 has passed.');
  });

  it('does not add FOLLOW_UP_AFTER_DAYS to a missed deadline (no event word)', () => {
    // Read on Nov 17: an event on Nov 14 would be "due today"; a deadline is not.
    const f = followUpFor('Complete the assessment by Nov 14', NOW_F);
    expect(f?.lead).toBe('Nov 14 has passed.');
    expect(f?.status).toBe('Overdue by 3 days');
    expect(f?.dueInDays).toBe(-3);
  });

  it.each([
    // [deadline date, status on Nov 17, dueInDays]: counted from the date itself
    ['Nov 16', 'Overdue by 1 day', -1],
    ['Nov 15', 'Overdue by 2 days', -2],
    ['Nov 10', 'Overdue by 7 days', -7],
  ])('a deadline on %s, seen on Nov 17: %s', (date, status, dueInDays) => {
    const f = followUpFor(`Send the deck by ${date}`, NOW_F);
    expect(f?.status).toBe(status);
    expect(f?.dueInDays).toBe(dueInDays);
  });

  it('picks the latest date by calendar order, not by position in the text', () => {
    // The later-in-text date (Nov 3) is the EARLIER day.
    const f = followUpFor('Meeting on Nov 12, moved from Nov 3', NOW_F);
    expect(f?.lead).toBe('Follow up on the meeting from Nov 12.');
    expect(f?.dueInDays).toBe(-2); // due Nov 15
  });

  it.each([
    // [date in text, status on Nov 17, dueInDays]
    ['Nov 16', 'Follow-up due in 2 days', 2], // date+1
    ['Nov 15', 'Follow-up due in 1 day', 1], // date+2
    ['Nov 14', 'Follow-up due today', 0], // date+3
    ['Nov 13', 'Follow-up overdue by 1 day', -1], // date+4
    ['Nov 10', 'Follow-up overdue by 4 days', -4], // date+7
  ])('a meeting on %s, seen on Nov 17: %s', (date, status, dueInDays) => {
    const f = followUpFor(`Meeting on ${date}`, NOW_F);
    expect(f?.status).toBe(status);
    expect(f?.dueInDays).toBe(dueInDays);
  });

  it('counts local calendar days: late evening and early morning agree', () => {
    for (const hour of [0, 23]) {
      const f = followUpFor('Meeting on Nov 13', new Date(2026, 10, 17, hour, 59));
      expect(f?.status).toBe('Follow-up overdue by 1 day');
    }
    // 00:01 on the due day is "today", 23:59 the night before is still "in 1 day".
    expect(followUpFor('Meeting on Nov 13', new Date(2026, 10, 16, 0, 1))?.status).toBe(
      'Follow-up due today',
    );
    expect(followUpFor('Meeting on Nov 13', new Date(2026, 10, 15, 23, 59))?.status).toBe(
      'Follow-up due in 1 day',
    );
  });

  it('is not thrown off by a DST change (US fall back Nov 1, spring forward Mar 8, 2026)', () => {
    expect(followUpFor('Meeting on Oct 30', new Date(2026, 10, 2, 0, 30))?.status).toBe(
      'Follow-up due today',
    );
    expect(followUpFor('Meeting on Mar 6', new Date(2026, 2, 9, 0, 30))?.status).toBe(
      'Follow-up due today',
    );
  });

  it('formats a full-year or numeric date as a short month and day', () => {
    expect(followUpFor('Send notes from 2026-09-03', NOW_F)?.lead).toBe(
      'Sep 3 has passed.',
    );
  });
});
