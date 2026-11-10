/** @jest-environment node */
import { classifyInboundEmailWithRules } from './emailClassificationEngine.js';
import {
  classificationInputFromEmail,
  parseForwardedEmail,
} from './emailForwardedParser.js';
import {
  outlookOutboundTopNoNote,
  outlookOutboundTopWithSignature,
} from './__fixtures__/outlookOutboundTopMessage.js';

// Prod 2026-11-10: the forwarder's own reply was the top message. The parser
// skipped every Outlook header that carried a Cc: line, treated the forwarder's
// 12:29 AM reply as the envelope, and classified the recruiter's Nov 9 message
// with the whole quoted history, so an earlier (reversed) decline made it a
// Rejection.
const FWD_SUBJECT =
  'FW: Solution Architect !! Location:  Example City !!';
const FORWARDER = 'steve@terapak.com';

describe.each([
  ['no note above the top message', outlookOutboundTopNoNote],
  ['signature above the top message', outlookOutboundTopWithSignature],
])('Outlook forward whose top message is the forwarder\'s own reply (%s)', (_label, body) => {
  it('identifies the top message as outbound from the forwarder', () => {
    const meta = parseForwardedEmail(FWD_SUBJECT, FORWARDER, body);
    expect(meta.isForwarded).toBe(true);
    expect(meta.topMessageFromForwarder).toBe(true);
  });

  it('takes the counterparty from the nearest quoted message by someone else', () => {
    const meta = parseForwardedEmail(FWD_SUBJECT, FORWARDER, body);
    expect(meta.originalSenderEmail).toBe('ravi.kumar@acmestaffing.example');
    expect(meta.originalSenderName).toBe('Ravi Kumar');
  });

  it('keeps the top message subject and recipient', () => {
    const meta = parseForwardedEmail(FWD_SUBJECT, FORWARDER, body);
    expect(meta.originalSubject).toMatch(/^RE: Solution Architect/);
    expect(meta.originalRecipient).toBe('ravi.kumar@acmestaffing.example');
  });

  it('gives the classifier only the top message, written by the forwarder', () => {
    const input = classificationInputFromEmail({
      subject: FWD_SUBJECT,
      fromEmail: FORWARDER,
      textBody: body,
    });
    expect(input.fromEmail).toBe(FORWARDER);
    expect(input.textBody).toMatch(/^Hi Ravi,\s+Thanks for confirming\. I'm open to moving forward/);
    expect(input.textBody).not.toContain("I'm going to pass on this one");
    expect(input.textBody).not.toContain('Please do share your updated cv');
    expect(input.textBody).not.toContain('From: Ravi Kumar');
  });

  it('does not classify the forwarder\'s acceptance as a Rejection (rules path, no LLM)', () => {
    const input = classificationInputFromEmail({
      subject: FWD_SUBJECT,
      fromEmail: FORWARDER,
      textBody: body,
    });
    const result = classifyInboundEmailWithRules({
      subject: input.subject,
      fromEmail: input.fromEmail,
      textBody: input.textBody,
    });
    expect(result.classification).not.toBe('Rejection');
  });
});

describe('controls: forwards whose top message is not outbound', () => {
  it('a recruiter message forwarded with Cc headers keeps its full body and is not outbound', () => {
    const body = `________________________________
From: Ravi Kumar <Ravi.Kumar@acmestaffing.example>
Sent: Tuesday, 10 November 2026 05:49:19
To: Steve Terapak <steve@terapak.com>
Cc: Cc One <cc.one@acmestaffing.example>
Subject: RE: Solution Architect

Hi Steve,

Please do share your updated cv as per JD asap

From: Steve Terapak <steve@terapak.com>
Sent: Tuesday, November 10, 2026 12:29 AM
To: Ravi Kumar <Ravi.Kumar@acmestaffing.example>
Subject: RE: Solution Architect

Hi Ravi, what is the maximum approved budget?`;
    const meta = parseForwardedEmail('FW: RE: Solution Architect', FORWARDER, body);
    expect(meta.topMessageFromForwarder).toBe(false);
    expect(meta.originalSenderEmail).toBe('ravi.kumar@acmestaffing.example');
    // Unchanged behaviour: a non-outbound forward still carries the quoted history.
    expect(meta.originalBody).toContain('what is the maximum approved budget');
  });

  it('an Outlook "Fw:" envelope from the forwarder to the inbox is still unwrapped, not outbound', () => {
    const body = `________________________________
From: Steve Terapak <steve@terapak.com>
Sent: Monday, July 6, 2026 12:22 PM
To: jobinfo@jobs.terapak.com
Cc: someone@example.com
Subject: Fw: Job Application Acknowledgement - Director, Generative AI

________________________________
From: Njoyn Helpdesk <helpdesk@njoyn.com> on behalf of CGI <help.candidate@njoyn.com>
Sent: Monday, July 6, 2026 12:21 PM
To: Steve Terapak <steve@terapak.com>
Subject: Job Application Acknowledgement - Director, Generative AI

Dear Steve Terapak
Thank you for your interest in a career with CGI.`;
    const meta = parseForwardedEmail('Fw: Job Application Acknowledgement', FORWARDER, body);
    expect(meta.topMessageFromForwarder).toBe(false);
    expect(meta.originalSenderEmail).toBe('help.candidate@njoyn.com');
    expect(meta.originalCompany).toBe('CGI');
  });
});
