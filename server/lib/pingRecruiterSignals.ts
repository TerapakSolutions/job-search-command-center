/**
 * Deterministic signals behind the "Ping recruiter" nudge (no LLM call).
 *
 * The nudge's clock is a contact's lastContactDate, which an email in either
 * direction restarts. Two kinds of email must not leave a wait-for-reply clock
 * running as if nothing happened:
 *   - a decline YOU sent ("please don't submit my profile"): it suggests closing
 *     the thread instead (the user confirms on Today);
 *   - a recruiter's bulk re-send of a job you already discussed, with you only in
 *     Bcc: it is logged, but it is not a reply, so the clock stays.
 */

// "Don't submit me until X" is a hold, not a decline; "I'll withdraw if X" is a
// condition (the classifier treats holds the same way).
const CONDITION = /\b(?:until|till|unless|before|without|if|whether|yet|for now)\b/;
const ROLE_OBJECT =
  /^\s+in\s+(?:pursuing|moving|proceeding|continuing|being|(?:this|that|the|your)\s+(?:[\w-]+\s+){0,4}(?:role|position|opportunity|job|opening|contract)\b|(?:this|it)\s*(?:[.!,;]|$))/;

function sentenceDeclines(sentence: string): boolean {
  if (sentence.endsWith('?') || CONDITION.test(sentence)) return false;
  if (/\b(?:do not|don't|dont)\s+submit\s+(?:me\b|my\s+(?:profile|resume|r\u00e9sum\u00e9|candidacy|application)\b)/.test(sentence)) {
    return true;
  }
  const represented = /\balready\s+(?:been\s+)?represented\b(?!\s+by\s+you)/.exec(sentence);
  if (represented && !/\b(?:not|never)\b|n't\b/.test(sentence.slice(0, represented.index))) return true;

  const uninterested = /\b(?:not|no longer)\s+interested\b/.exec(sentence);
  if (uninterested) {
    const before = sentence.slice(0, uninterested.index);
    const after = sentence.slice(uninterested.index + uninterested[0].length);
    const aboutYou = !/\b(?:you|you're|he|she|they|client|manager|team|not that)\b/.test(before);
    if (aboutYou && (!/^\s+in\b/.test(after) || ROLE_OBJECT.test(after))) return true;
  }

  const withdraw =
    /\bwithdraw(?:ing)?\s+(?:me\b|my\s+(?:application|candidacy|profile|resume|name|submission)\b|from\b)/.exec(sentence);
  return Boolean(withdraw && !/\b(?:not|never|you)\b|n't\b/.test(sentence.slice(0, withdraw.index)));
}

/**
 * True when the message you wrote declines or withdraws from the role.
 * `topMessage` is your own text only, never quoted history. Outlook writes
 * curly apostrophes; lines may be hard-wrapped.
 *
 * Deliberately simple, with known misses ("I'm not interested, but let me know
 * if something else comes up", "I have withdrawn", a reply typed below the
 * quote) and false prompts ("I was already represented last year", "no longer
 * interested in the other contract"). A false prompt is confirmable, but until
 * answered that contact is out of the clock.
 */
export function isOutboundDecline(input: { topMessage: string; classification: string | null }): boolean {
  if (input.classification === 'Already Submitted Elsewhere') return true;
  return input.topMessage
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .split(/\n\s*\n/)
    .flatMap((paragraph) => paragraph.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]?/g) ?? [])
    .some((sentence) => sentenceDeclines(sentence.trim()));
}

/** A subject without its leading RE:/FW:/FWD: prefixes, for "same thread" checks. */
export function normalizeThreadSubject(subject: string): string {
  let s = subject.trim().toLowerCase();
  for (;;) {
    const next = s.replace(/^(?:re|fw|fwd)\s*:\s*/, '');
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, ' ');
}

/**
 * A recruiter's message that is NOT a reply to you: they addressed it only to
 * themselves (you were in Bcc of a mass mail) AND it repeats a job you already
 * exchanged with this contact (an earlier communication with the same subject
 * once RE:/FW: prefixes are stripped). Anything else counts as a reply: headers
 * that can't be read, any other recipient (it may be an alias of yours), and a
 * block that isn't the recruiter's own message (your forwarding envelope).
 */
export function isBulkResendNotReply(input: {
  forwarded: { sender: string; recipients: string[] } | null;
  senderEmail: string;
  ownAddresses: string[];
  subject: string;
  earlierSubjects: string[];
}): boolean {
  const { forwarded } = input;
  const sender = input.senderEmail.trim().toLowerCase();
  if (!forwarded || !sender || forwarded.sender !== sender) return false;
  if (input.ownAddresses.some((a) => a.trim().toLowerCase() === sender)) return false;
  if (forwarded.recipients.some((r) => r !== sender)) return false;
  const subject = normalizeThreadSubject(input.subject);
  return subject !== '' && input.earlierSubjects.some((s) => normalizeThreadSubject(s) === subject);
}
