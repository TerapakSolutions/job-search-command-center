/** @jest-environment node */
import {
  extractEmployerFromSubject,
  extractInterviewDatetime,
  extractRoleFromInterviewSubject,
  inferEmployerFromSenderEmail,
  isAtsPlatformCompany,
  isAtsSenderEmail,
  isInterviewConfirmationText,
  resolveEmployerCompany,
  resolveRoleTitle,
} from './emailContentExtraction.js';

describe('emailContentExtraction', () => {
  it('detects ATS platforms and senders', () => {
    expect(isAtsPlatformCompany('Workday')).toBe(true);
    expect(isAtsPlatformCompany('Pathstream')).toBe(false);
    expect(isAtsSenderEmail('noreply@myworkday.com')).toBe(true);
    expect(isAtsSenderEmail('jhardin@pathstream.com')).toBe(false);
  });

  it('extracts Pathstream employer and role from interview confirmation subject', () => {
    const subject = 'Pathstream | Interview Confirmation for Engineering Manager';
    expect(extractEmployerFromSubject(subject)).toBe('Pathstream');
    expect(extractRoleFromInterviewSubject(subject)).toBe('Engineering Manager');
    expect(isInterviewConfirmationText(subject)).toBe(true);
  });

  it('resolves employer from subject before ATS platform names', () => {
    expect(
      resolveEmployerCompany({
        companyName: 'Workday',
        originalCompany: 'Workday',
        subject: 'Pathstream | Interview Confirmation for Engineering Manager',
        senderEmail: 'noreply@myworkday.com',
      }),
    ).toBe('Pathstream');
  });

  it('falls back to recruiter sender domain when subject lacks employer', () => {
    expect(inferEmployerFromSenderEmail('jhardin@pathstream.com')).toBe('Pathstream');
    expect(
      resolveEmployerCompany({
        companyName: 'Workday',
        senderEmail: 'jhardin@pathstream.com',
      }),
    ).toBe('Pathstream');
  });

  it('extracts interview datetime from confirmation body', () => {
    const datetime = extractInterviewDatetime(
      'Your interview is confirmed for July 5, 2026 at 2:00 PM PT.',
    );
    expect(datetime).toMatch(/^2026-07-05/);
  });

  // Real Pathstream Outlook confirmation body (forward-stripped, as the parser
  // receives it). Contains both the inline weekday-prefixed phrasing and the
  // labeled Date/Time: line. Captured verbatim from the production email row.
  const REAL_PATHSTREAM_BODY = [
    'Hi Steve,',
    '',
    'Thank you for sharing your availability for the Engineering Manager position at Pathstream. Your interview is now confirmed for Tuesday July 7, 6:00pm EST - 3:00pm PST with James Peel SVP of Engineering',
    '',
    'Please use the Zoom link below to join the meeting:',
    '',
    'Date/Time: Jul 7, 2026 6:00pm-7:00pm (GMT-04:00) Eastern Time (US & Canada)',
    'Interviewers: James Peel',
  ].join('\n');

  it('extracts datetime from the real Pathstream Outlook confirmation body', () => {
    expect(extractInterviewDatetime(REAL_PATHSTREAM_BODY)).toMatch(/^2026-07-07/);
  });

  it('parses inline weekday-prefixed phrasing ("confirmed for Tuesday July 7, ... 6:00pm EST")', () => {
    // Year is inferred from elsewhere in the email (the labeled line here).
    const text =
      'Your interview is now confirmed for Tuesday July 7, 6:00pm EST - 3:00pm PST.\nDate/Time: Jul 7, 2026 6:00pm Eastern Time';
    expect(extractInterviewDatetime(text)).toMatch(/^2026-07-07/);
  });

  it('parses a weekday-prefixed phrase with an explicit year', () => {
    expect(
      extractInterviewDatetime(
        'Your interview is confirmed for Tuesday July 7, 2026 at 6:00pm EST',
      ),
    ).toMatch(/^2026-07-07/);
  });

  it('parses labeled "Date/Time:" line phrasing', () => {
    expect(
      extractInterviewDatetime(
        'Date/Time: Jul 7, 2026 6:00pm-7:00pm (GMT-04:00) Eastern Time (US & Canada)',
      ),
    ).toMatch(/^2026-07-07/);
  });

  it('returns null when no interview date/time is present', () => {
    expect(
      extractInterviewDatetime("Let's find some time next week to chat."),
    ).toBeNull();
  });

  // Timezone resolution: the stored value must be the TRUE instant when the
  // email declares its timezone, so local rendering (toLocaleString) shows the
  // correct time everywhere (6:00 PM ET == 3:00 PM PT == 22:00Z).
  it('converts an explicit GMT offset to the true instant', () => {
    expect(
      extractInterviewDatetime(
        'Date/Time: Jul 7, 2026 6:00pm-7:00pm (GMT-04:00) Eastern Time (US & Canada)',
      ),
    ).toBe('2026-07-07T22:00:00.000Z');
  });

  it('prefers the explicit GMT offset over an inline abbreviation elsewhere in the email', () => {
    // The real body says "6:00pm EST" inline (sloppy recruiter shorthand for
    // Eastern in July) but the Zoom Date/Time line carries the authoritative
    // GMT-04:00 offset — that one must win.
    expect(extractInterviewDatetime(REAL_PATHSTREAM_BODY)).toBe(
      '2026-07-07T22:00:00.000Z',
    );
  });

  it('converts a bare timezone abbreviation using its literal fixed offset', () => {
    expect(
      extractInterviewDatetime(
        'Your interview is confirmed for Tuesday July 7, 2026 at 6:00pm EST',
      ),
    ).toBe('2026-07-07T23:00:00.000Z'); // EST is literally UTC-5
  });

  it('keeps wall-clock-as-UTC behavior when no timezone is present', () => {
    expect(
      extractInterviewDatetime('Your interview is confirmed for July 5, 2026 at 2:00 PM.'),
    ).toBe('2026-07-05T14:00:00.000Z');
  });

  it('resolves role title from interview subject', () => {
    expect(
      resolveRoleTitle({
        positionTitle: null,
        subject: 'Pathstream | Interview Confirmation for Engineering Manager',
      }),
    ).toBe('Engineering Manager');
  });
});
