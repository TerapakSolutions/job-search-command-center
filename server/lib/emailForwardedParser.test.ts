/** @jest-environment node */
import { classifyInboundEmailWithRules } from './emailClassificationEngine.js';
import {
  classificationInputFromEmail,
  parseForwardedEmail,
} from './emailForwardedParser.js';

describe('parseForwardedEmail', () => {
  it('extracts original sender from Gmail-style forwarded block', () => {
    const textBody = `Hi,

See below.

---------- Forwarded message ---------
From: Workday Notifications <noreply@myworkday.com>
Date: Mon, Jul 1, 2026 at 9:00 AM
Subject: Thank You for Your Application!
To: steve@terapak.com

Thank you for your application to Software Engineer at PwC.`;

    const result = parseForwardedEmail(
      'Fwd: Thank You for Your Application!',
      'steve@terapak.com',
      textBody,
    );

    expect(result.isForwarded).toBe(true);
    expect(result.originalSenderEmail).toBe('noreply@myworkday.com');
    expect(result.originalSubject).toBe('Thank You for Your Application!');
    expect(result.originalBody).toContain('Thank you for your application');
    expect(result.originalCompany).toBeNull();
  });

  it('extracts Outlook-style forwarded headers', () => {
    const textBody = `From: TELUS Careers <careers@telus.com>
Sent: Monday, July 1, 2026 10:15 AM
To: steve@terapak.com
Subject: Application received

We received your application.`;

    const result = parseForwardedEmail(
      'FW: Application received',
      'steve@terapak.com',
      textBody,
    );

    expect(result.isForwarded).toBe(true);
    expect(result.originalSenderEmail).toBe('careers@telus.com');
    expect(result.originalSubject).toBe('Application received');
  });

  it('extracts Pathstream interview confirmation from forwarded block', () => {
    const textBody = `---------- Forwarded message ---------
From: John Hardin <jhardin@pathstream.com>
Date: Mon, Jul 1, 2026 at 2:00 PM
Subject: Pathstream | Interview Confirmation for Engineering Manager
To: seeker@example.com

Your interview with Pathstream for the Engineering Manager position is confirmed for July 5, 2026 at 2:00 PM PT.`;

    const result = parseForwardedEmail(
      'Fwd: Pathstream | Interview Confirmation for Engineering Manager',
      'steve@terapak.com',
      textBody,
    );

    expect(result.isForwarded).toBe(true);
    expect(result.originalSenderEmail).toBe('jhardin@pathstream.com');
    expect(result.originalSenderName).toBe('John Hardin');
    expect(result.originalSubject).toBe(
      'Pathstream | Interview Confirmation for Engineering Manager',
    );
    expect(result.originalCompany).toBe('Pathstream');
    expect(result.originalBody).toContain('confirmed for July 5, 2026');
  });
});

describe('classificationInputFromEmail', () => {
  it('uses original body and sender for forwarded application confirmations', () => {
    const textBody = `---------- Forwarded message ---------
From: Omada Health <no-reply@omadahealth.com>
Date: Tue, Jul 1, 2026 at 8:00 AM
Subject: Confirming your application
To: steve@terapak.com

Confirming your application for Product Manager.`;

    const input = classificationInputFromEmail({
      subject: 'Fwd: Confirming your application',
      fromEmail: 'steve@terapak.com',
      textBody,
    });

    expect(input.fromEmail).toBe('no-reply@omadahealth.com');
    expect(input.subject).toBe('Confirming your application');
    expect(input.textBody).toContain('Confirming your application');
  });
});

describe('classifyInboundEmailWithRules forwarded confirmations', () => {
  it('classifies Thank You for Your Application as Application Confirmation', () => {
    const result = classifyInboundEmailWithRules({
      subject: 'Thank You for Your Application!',
      fromEmail: 'noreply@myworkday.com',
      textBody: 'Thank you for your application to the role at PwC.',
    });

    expect(result.classification).toBe('Application Confirmation');
    expect(result.classification).not.toBe('Recruiter Outreach');
  });

  it('classifies forwarded confirmation using original body', () => {
    const textBody = `---------- Forwarded message ---------
From: Greenhouse <noreply@greenhouse.io>
Subject: Application confirmation
To: steve@terapak.com

Greenhouse application received for Staff Engineer.`;

    const classified = classificationInputFromEmail({
      subject: 'Fwd: Application confirmation',
      fromEmail: 'steve@terapak.com',
      textBody,
    });

    const result = classifyInboundEmailWithRules({
      subject: classified.subject,
      fromEmail: classified.fromEmail,
      textBody: classified.textBody,
    });

    expect(result.classification).toBe('Application Confirmation');
  });

  it('classifies forwarded Pathstream interview confirmation using original sender and body', () => {
    const textBody = `---------- Forwarded message ---------
From: John Hardin <jhardin@pathstream.com>
Date: Mon, Jul 1, 2026 at 2:00 PM
Subject: Pathstream | Interview Confirmation for Engineering Manager
To: seeker@example.com

Your interview with Pathstream for the Engineering Manager position is confirmed for July 5, 2026 at 2:00 PM PT.`;

    const classified = classificationInputFromEmail({
      subject: 'Fwd: Pathstream | Interview Confirmation for Engineering Manager',
      fromEmail: 'steve@terapak.com',
      textBody,
    });

    const result = classifyInboundEmailWithRules({
      subject: classified.subject,
      fromEmail: classified.fromEmail,
      textBody: classified.textBody,
    });

    expect(result.classification).toBe('Scheduling');
    expect(result.companyName).toBe('Pathstream');
    expect(result.positionTitle).toBe('Engineering Manager');
    expect(result.interviewDatetime).toMatch(/^2026-07-05/);
  });
});
