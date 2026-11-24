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

// Your own message (the top message only, never quoted history) declining or
// withdrawing. Outlook writes curly apostrophes ("don’t"), normalised first.
const DECLINE_PATTERNS: RegExp[] = [
  /\b(?:do not|don't|dont)\s+submit\s+my\s+(?:profile|resume|r[ée]sum[ée]|candidacy|application)\b/,
  /\balready\s+(?:been\s+)?represented\b/,
  /\b(?:i\s*am|i'm|im)\s+not\s+interested\b/,
  /\bwithdraw(?:ing)?\s+(?:my\s+(?:application|candidacy|profile)|from)\b/,
];

/** True when the message you wrote declines or withdraws from the role. */
export function isOutboundDecline(input: { topMessage: string; classification: string | null }): boolean {
  if (input.classification === 'Already Submitted Elsewhere') return true;
  const text = input.topMessage.toLowerCase().replace(/[‘’]/g, "'");
  return DECLINE_PATTERNS.some((p) => p.test(text));
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
 * A recruiter's message that is NOT a reply to you: the forwarded message's
 * To:/Cc: lists none of your addresses (you were in Bcc of a mass mail) AND it
 * repeats a job you already exchanged with this contact (an earlier
 * communication with the same subject once RE:/FW: prefixes are stripped).
 * When the To: line can't be read, it counts as a reply.
 */
export function isBulkResendNotReply(input: {
  recipients: string[];
  ownAddresses: string[];
  subject: string;
  earlierSubjects: string[];
}): boolean {
  if (input.recipients.length === 0) return false;
  const own = new Set(input.ownAddresses.map((a) => a.trim().toLowerCase()).filter(Boolean));
  if (input.recipients.some((r) => own.has(r))) return false;
  const subject = normalizeThreadSubject(input.subject);
  return subject !== '' && input.earlierSubjects.some((s) => normalizeThreadSubject(s) === subject);
}
