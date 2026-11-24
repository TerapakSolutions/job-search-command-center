/** @jest-environment node */
import { forwardedMessageRecipients } from './emailForwardedParser.js';
import { isBulkResendNotReply, isOutboundDecline } from './pingRecruiterSignals.js';

const flagged = (topMessage: string) => isOutboundDecline({ topMessage, classification: 'Other' });

describe('isOutboundDecline', () => {
  it.each([
    'Please don’t submit my profile for it.',
    'please do not submit my\nresume.',
    'Please do not submit me.',
    'Hi Maya,\n\nNot interested, thanks',
    "I'm not interested.",
    'I am not interested in this role.',
    "Thanks, but I'm not interested in moving forward.",
    "I'm no longer interested.",
    'No longer interested, sorry.',
    "I'm already represented for this role.",
    'I have already been represented by another vendor.',
    'Please withdraw me.',
    'I would like to withdraw my application.',
    "I'm withdrawing from consideration.",
  ])('flags: %s', (t) => expect(flagged(t)).toBe(true));

  it.each([
    "Please don't submit my profile until I confirm the rate.",
    'Do not submit me before we talk.',
    "Please don't submit my resume without checking with me.",
    'I am not already represented for this role, so please go ahead.',
    "I'm not already represented, go ahead.",
    'Am I already represented by your firm?',
    'Am I already represented for this role?',
    "I'm not interested in relocating, but remote works.",
    "If you're not interested any more, let me know.",
    "I'm not interested unless the rate goes up.",
    "I don't want to withdraw my application.",
    'I will withdraw my application if the rate drops.',
    'Is the client not interested?',
    'Just following up. Any update?',
  ])('does not flag: %s', (t) => expect(flagged(t)).toBe(false));
});

describe('isBulkResendNotReply', () => {
  const OMAR = 'omar.vance@vendor-b.example';
  const check = (body: string, sender = OMAR) =>
    isBulkResendNotReply({
      forwarded: forwardedMessageRecipients(body),
      senderEmail: sender,
      ownAddresses: ['jordan.pike@seeker.example'],
      subject: 'FW: RE: Solutions Architect',
      earlierSubjects: ['FW: Solutions Architect'],
    });
  const mail = (to: string, from = `Omar Vance <${OMAR}>`, subject = 'Solutions Architect') =>
    `________________________________\nFrom: ${from}\nSent: Monday, November 23, 2026 9:42 AM\nTo: ${to}\nSubject: ${subject}\n\nHi\n`;

  it('is true only for a mail the sender addressed to themselves', () => {
    expect(check(mail(`Omar Vance <${OMAR}>`))).toBe(true);
    expect(check(mail(`Omar Vance <${OMAR}<mailto:${OMAR}>>`, `Omar Vance <${OMAR}<mailto:${OMAR}>>`))).toBe(true);
    expect(check(mail(`Omar Vance <${OMAR}>`).replace(/\n/g, '\r\n'))).toBe(true);
    expect(check(`---------- Forwarded message ---------\n${mail(`Omar Vance <${OMAR}>`).split('\n').slice(1).join('\n')}`)).toBe(true);
  });

  it.each([
    ['an alias of yours', mail('Jordan <j.pike@alias.example>')],
    ['a wrapped To: line', mail(`Omar Vance <${OMAR}>;\n Jordan Pike <jordan.pike@seeker.example>`)],
    ['a wrapped To: line with no separator', mail(`Omar Vance <${OMAR}>\n Jordan Pike <jordan.pike@seeker.example>`)],
    ['a wrapped To: line under a forward marker', `---------- Forwarded message ---------\n${mail(`Omar Vance <${OMAR}>;\n Jordan Pike <jordan.pike@seeker.example>`).split('\n').slice(1).join('\n')}`],
    ['a bare display name', mail('Jordan Pike')],
    ['two addresses in one entry', mail(`${OMAR} j.pike@alias.example`)],
    ['no To: line', mail('x').replace(/To: x\n/, '')],
    ['your own Fw: envelope', mail('Me <j.pike@alias.example>', 'Jordan Pike <jordan.pike@seeker.example>', 'Fw: Solutions Architect') + mail('Jordan <j.pike@alias.example>')],
    ['your own Fw: envelope to yourself at a second address', mail('Me <j.pike@alias.example>', 'Me <j.pike@alias.example>', 'Fw: Solutions Architect') + mail(`Omar Vance <${OMAR}>`)],
    ['you in Cc', mail(`Omar Vance <${OMAR}>\nCc: Jordan <j.pike@alias.example>`)],
  ])('counts as a reply: %s', (_l, body) => expect(check(body)).toBe(false));
});
