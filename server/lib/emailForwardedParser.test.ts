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

  it('unwraps a double-forwarded CGI/Njoyn acknowledgement to sender, company, and class', () => {
    const textBody = `________________________________
From: Steve Terapak <steve@terapak.com>
Sent: Monday, July 6, 2026 12:22 PM
To: jobinfo@jobs.terapak.com
Subject: Fw: Job Application Acknowledgement - Director, Generative AI

________________________________
From: Njoyn Helpdesk <helpdesk@njoyn.com> on behalf of CGI <help.candidate@njoyn.com>
Sent: Monday, July 6, 2026 12:21 PM
To: Steve Terapak <steve@terapak.com>
Subject: Job Application Acknowledgement - Director, Generative AI

Dear Steve Terapak
Thank you for your interest in a career with CGI. We are pleased to confirm the receipt of your resume.`;

    // Parser: skip the outer forwarder (you), resolve the "on behalf of" employer.
    const meta = parseForwardedEmail(
      'Fw: Job Application Acknowledgement',
      'steve@terapak.com',
      textBody,
    );
    expect(meta.originalSenderEmail).toBe('help.candidate@njoyn.com');
    expect(meta.originalCompany).toBe('CGI');

    // End-to-end: unwrapped content classifies as a confirmation, company CGI.
    const classified = classificationInputFromEmail({
      subject: 'Fw: Job Application Acknowledgement - Director, Generative AI',
      fromEmail: 'steve@terapak.com',
      textBody,
    });
    const result = classifyInboundEmailWithRules({
      subject: classified.subject,
      fromEmail: classified.fromEmail,
      textBody: classified.textBody,
    });
    expect(result.classification).toBe('Application Confirmation');
    expect(result.companyName).toBe('CGI');
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

describe('parseForwardedEmail: Apple Mail dates', () => {
  // Apple Mail writes "October 21, 2026 at 8:20:08 AM PDT"; JS Date rejects
  // the " at ", so every Apple Mail forward lost its original sent date and
  // applications were dated the day they were forwarded (prod, 2026-10-26).
  it.each([
    ['October 21, 2026 at 8:20:08 AM PDT', '2026-10-21T15:20:08.000Z'],
    ['July 13, 2026 at 7:30:26 AM EDT', '2026-07-13T11:30:26.000Z'],
    ['Oct 3, 2026 at 7:05 PM PST', '2026-10-04T03:05:00.000Z'],
  ])('reads %s', (dateLine, expected) => {
    const body = `Begin forwarded message:\n\nFrom: Acme <jobs@acme.com>\nSubject: Thanks for applying\nDate: ${dateLine}\nTo: seeker@example.com\n\nThanks!`;
    expect(
      parseForwardedEmail('Fwd: Thanks for applying', 'seeker@example.com', body)
        .originalSentAt,
    ).toBe(expected);
  });

  it('still reads Gmail-style dates', () => {
    const body = `---------- Forwarded message ---------\nFrom: Acme <jobs@acme.com>\nDate: Mon, Jul 1, 2026 at 2:00 PM\nSubject: Hi\nTo: seeker@example.com\n\nHi`;
    expect(
      parseForwardedEmail('Fwd: Hi', 'seeker@example.com', body).originalSentAt,
    ).toMatch(/^2026-07-01T/);
  });
});
