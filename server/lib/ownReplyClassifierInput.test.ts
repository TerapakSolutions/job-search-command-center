/** @jest-environment node */
import { QUOTED_HISTORY, classificationInputFromEmail, ownWords } from './emailForwardedParser.js';
import { SEEKER, SEEKER_NAME, VENDOR_A, vendorADeclineForward } from './__fixtures__/pingRecruiterThreads.js';

const head = vendorADeclineForward.slice(0, vendorADeclineForward.indexOf('Hi Maya,'));
const input = (text: string) =>
  classificationInputFromEmail({ subject: 'FW: RE: x', fromEmail: SEEKER, fromName: SEEKER_NAME, textBody: `${head}${text}\n` });

// Decline detection reads its own stripped copy (ownWords). What the classifier
// and the rules read is what they read before that existed: only an Outlook
// header block ends the message.
describe('classifier input for your own forwarded reply keeps inline quotes', () => {
  it.each([
    ['plain', 'Any update?'],
    ['On … wrote:', `Any update?\n\nOn Tue, Nov 10, 2026 at 1:04 PM Maya Lund <${VENDOR_A}> wrote:\n\nTitle: Data Engineer`],
    ['On … wrote: wrapped', `Any update?\n\nOn Tue, Nov 10, 2026 at 1:04 PM Maya Lund <${VENDOR_A}>\nwrote:\n\nTitle: Data Engineer`],
    ['> marks', 'Any update?\n> Title: Data Engineer\n> Remote\nThanks'],
    ['only a quote', '> Title: Data Engineer'],
    ['Original Message', 'Any update?\n\n-- Original Message --\nTitle: Data Engineer'],
  ])('%s', (_l, text) => expect(input(text).textBody).toBe(text));

  it('an Outlook header block still ends it', () => {
    expect(input(`Any update?\n\n________________________________\nFrom: Maya Lund <${VENDOR_A}>\nSent: Tuesday, November 10, 2026 1:04 PM\nTo: x\nSubject: x\n\nTitle`).textBody).toBe('Any update?');
  });
});

describe('QUOTED_HISTORY', () => {
  it.each([
    `On Tue, Nov 10, 2026 at 1:04 PM Maya Lund <${VENDOR_A}>\nwrote:`,
    `On Tue, Nov 10, 2026 at 1:04 PM Maya Lund\n<${VENDOR_A}> wrote:`,
    'On November 10, 2026, at 1:04 PM, Maya Lund\r\nwrote:',
    'On Tue, Nov 10 Maya Lund wrote:',
    '-- Original Message --',
    'From: Maya',
  ])('matches %j', (t) => expect(`Hi\n\n${t}\n`).toMatch(QUOTED_HISTORY));

  it.each([
    'On Monday we meet the panel.\nHere is what the manager wrote:',
    'On reflection I agree\nwith what she wrote:',
    'On Nov 10, 2026 we met the panel.\nHere is what the manager wrote:',
  ])('leaves prose alone: %j', (t) => expect(`Hi\n\n${t}\n`).not.toMatch(QUOTED_HISTORY));

  // The rule main had, for every line that isn't wrapped.
  it('gives the old answer wherever no line is wrapped', () => {
    const before = /^(?:_{10,}\s*$|-{2,}\s*original message|on .+wrote:\s*$|from:\s.+$)/im;
    for (const t of ['Hi', 'On it. She wrote:', 'On Monday she wrote: yes', 'from: me', '__________', '---original message', 'On 2026 a@b.example', vendorADeclineForward]) {
      expect(t.search(QUOTED_HISTORY)).toBe(t.search(before));
    }
  });
});

describe('ownWords', () => {
  it('drops quotes and keeps answers typed between > lines', () => {
    expect(ownWords('Yes.\n> please do\nThanks')).toBe('Yes.\n\nThanks');
    expect(ownWords('Yes.\n\nOn Tue Maya wrote:\nno longer interested')).toBe('Yes.');
    expect(ownWords('> quoted')).toBe('');
  });
});
