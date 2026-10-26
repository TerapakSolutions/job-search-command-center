/** @jest-environment node */
import { APPLE_MAIL_THREE_FORWARD_BUNDLE_PAYLOAD } from './__fixtures__/appleMailThreeForwardBundle.js';
import { parseForwardedEmail } from './emailForwardedParser.js';
import { splitForwardBundle } from './forwardBundleSplitter.js';

const SINGLE_FORWARD_PAYLOAD = {
  From: 'seeker@example.com',
  OriginalRecipient: 'seeker@example.com',
  Subject: 'Fwd: Thank you for applying to Vetcove!',
  MessageID: 'single-1',
  TextBody: `Begin forwarded message:

From: Vetcove Hiring <no-reply@ashbyhq.com>
Subject: Thank you for applying to Vetcove!
Date: July 13, 2026 at 7:30:26 AM PDT
To: seeker@example.com

Hi Alex,

Thanks for applying to the Engineering Manager role at Vetcove.`,
};

// A recruiter forwarded us a message from the employer; we then forwarded
// the recruiter's mail. Two markers, but the inner one is NESTED (addressed
// to the recruiter, not to us), so it is one email.
const NESTED_FORWARD_PAYLOAD = {
  From: 'seeker@example.com',
  OriginalRecipient: 'seeker@example.com',
  Subject: 'Fwd: FW: Next steps at Acme',
  MessageID: 'nested-1',
  TextBody: `Begin forwarded message:

From: Jane Recruiter <jane@agency.com>
Subject: FW: Next steps at Acme
Date: October 20, 2026 at 9:00:00 AM PDT
To: seeker@example.com

Alex - see below from the hiring manager.

Begin forwarded message:

From: Hiring Manager <hm@acme.com>
Subject: Next steps at Acme
Date: October 19, 2026 at 4:00:00 PM PDT
To: jane@agency.com

Jane, we'd like to move Alex to the onsite.`,
};

const REPLY_HISTORY_PAYLOAD = {
  From: 'seeker@example.com',
  OriginalRecipient: 'seeker@example.com',
  Subject: 'Fwd: Re: Manager, IT Programming',
  MessageID: 'reply-1',
  TextBody: `Begin forwarded message:

From: Vanessa Recruiter <vanessa@judge.com>
Subject: Re: Manager, IT Programming
Date: October 21, 2026 at 8:20:08 AM PDT
To: seeker@example.com

Thanks Alex, I'll set up a call.

On Oct 20, 2026, at 5:00 PM, seeker@example.com wrote:

-----Original Message-----
From: seeker@example.com
Subject: Manager, IT Programming

I'm interested.`,
};

describe('splitForwardBundle', () => {
  it('splits the real Apple Mail 3-message forward into 3 emails', () => {
    const parts = splitForwardBundle(APPLE_MAIL_THREE_FORWARD_BUNDLE_PAYLOAD);

    expect(parts).toHaveLength(3);
    const roles = parts.map((part) => {
      const meta = parseForwardedEmail(
        String(part.Subject),
        'seeker@example.com',
        String(part.TextBody),
      );
      expect(meta.isForwarded).toBe(true);
      expect(meta.originalSenderEmail).toBe('no-reply@ashbyhq.com');
      expect(meta.originalSubject).toBe(
        'Hello from Acme! We have your application.',
      );
      return meta.originalBody ?? '';
    });

    expect(roles[0]).toContain('Role One');
    expect(roles[1]).toContain('Role Two');
    expect(roles[2]).toContain('Role Three');
    // Each part carries only its own message, including its own Date line.
    expect(roles[0]).not.toContain('Role Two');
    expect(parts.map((p) => String(p.TextBody).match(/^Date: (.*)$/m)?.[1])).toEqual([
      'October 26, 2026 at 8:17:50 AM PDT',
      'October 26, 2026 at 7:32:03 AM PDT',
      'October 26, 2026 at 7:40:01 AM PDT',
    ]);
  });

  it('gives each part a subject, a deterministic MessageID and bundle info', () => {
    const parts = splitForwardBundle(APPLE_MAIL_THREE_FORWARD_BUNDLE_PAYLOAD);

    parts.forEach((part, index) => {
      expect(part.Subject).toBe(
        'Fwd: Hello from Acme! We have your application.',
      );
      expect(part.MessageID).toBe(
        `1384e1be-80fa-4155-ad4a-2d92f553bf85#part-${index + 1}`,
      );
      expect(part.BundleParentMessageID).toBe(
        '1384e1be-80fa-4155-ad4a-2d92f553bf85',
      );
      expect(part.BundlePart).toBe(index + 1);
      expect(part.BundleSize).toBe(3);
      // Whole-bundle bodies must not ride along on every part.
      expect(part.HtmlBody).toBe('');
      expect(part.RawEmail).toBe('');
      expect(part.Attachments).toEqual([]);
      expect(part.OriginalRecipient).toBe('seeker@example.com');
    });
  });

  it('returns a single forward unchanged', () => {
    const parts = splitForwardBundle(SINGLE_FORWARD_PAYLOAD);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(SINGLE_FORWARD_PAYLOAD);
  });

  it('does not split a nested forward (inner message addressed to someone else)', () => {
    const parts = splitForwardBundle(NESTED_FORWARD_PAYLOAD);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(NESTED_FORWARD_PAYLOAD);
  });

  it('does not split on reply history inside one forwarded email', () => {
    const parts = splitForwardBundle(REPLY_HISTORY_PAYLOAD);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(REPLY_HISTORY_PAYLOAD);
  });

  it('returns a non-forwarded email unchanged', () => {
    const payload = { Subject: 'Hello', TextBody: 'Just a note', MessageID: 'x' };
    expect(splitForwardBundle(payload)).toEqual([payload]);
  });
});
