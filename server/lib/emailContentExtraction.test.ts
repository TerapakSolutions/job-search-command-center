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

  it('resolves role title from interview subject', () => {
    expect(
      resolveRoleTitle({
        positionTitle: null,
        subject: 'Pathstream | Interview Confirmation for Engineering Manager',
      }),
    ).toBe('Engineering Manager');
  });
});
