/** @jest-environment node */
import {
  extractPostmarkFields,
  parsePostmarkReceivedAt,
} from './postmarkInbound.js';

describe('extractPostmarkFields', () => {
  it('extracts subject, from, to, and receivedAt from a Postmark payload', () => {
    const fields = extractPostmarkFields({
      Subject: 'Interview follow-up',
      FromFull: { Email: 'recruiter@example.com' },
      OriginalRecipient: 'jobs+123@inbound.example.com',
      Date: 'Thu, 5 Apr 2025 16:59:01 +0200',
    });

    expect(fields.subject).toBe('Interview follow-up');
    expect(fields.fromEmail).toBe('recruiter@example.com');
    expect(fields.toEmail).toBe('jobs+123@inbound.example.com');
    expect(fields.receivedAt).toBe(new Date('Thu, 5 Apr 2025 16:59:01 +0200').toISOString());
  });

  it('falls back to safe defaults for malformed payloads', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));

    const fields = extractPostmarkFields({});

    expect(fields.subject).toBe('');
    expect(fields.fromEmail).toBe('');
    expect(fields.toEmail).toBe('');
    expect(fields.receivedAt).toBe('2026-07-01T12:00:00.000Z');

    jest.useRealTimers();
  });
});

describe('parsePostmarkReceivedAt', () => {
  it('returns now when the date is missing or invalid', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));

    expect(parsePostmarkReceivedAt(undefined)).toBe('2026-07-01T12:00:00.000Z');
    expect(parsePostmarkReceivedAt('not-a-date')).toBe('2026-07-01T12:00:00.000Z');

    jest.useRealTimers();
  });
});
