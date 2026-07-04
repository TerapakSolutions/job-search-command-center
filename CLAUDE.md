# Working Agreements

## Bug fixes: scope discipline

This is the default for every bug fix, not just complex ones.

- **State intended scope up front, before work starts.** Name the specific file(s) or surface(s) expected to change. If a shared dependency might need touching, flag it as a possibility in advance — don't discover it mid-diff.
- **Smallest possible fix, no refactor**, unless refactor is explicitly requested as its own task. "While I'm in here" is not a reason to touch adjacent code.
- **One surface at a time.** If a bug shows up in two places (e.g. a Today-tab card and a detail page), fix one, ship it, verify it, then decide separately whether the second needs the same fix. Don't bundle them because they look similar.
- **Investigate before editing.** Trace the actual data/control flow first. Report where root cause diverges from symptom before proposing a fix. Distinguish real bugs from by-design behavior (e.g. confidence thresholds) and from stale data (a bad row, not bad code).
- **No after-the-fact scope policing.** Once a fix is scoped and sent, let it run. Review the result against the stated scope, don't micromanage the process.
- **Document edge cases, don't chase them.** If a fix surfaces a known limitation (DST-unaware abbreviations, a UTC date-boundary edge case, an open product decision), note it and move on. Only escalate into its own ticket if it's likely to bite for real.

## Escalation

- Default to the standard model for most fixes.
- Escalate to a top-tier/Mythos-class model (e.g. Fable 5) when a bug spans multiple stages/files with genuine ambiguity about root cause, or after ~2 iterations without resolution on a lesser model.
- Heavier models burn usage/budget faster — don't reach for them on fixes a smaller model would nail in one pass.

## Facts and figures

- Don't trust recalled numbers (spend figures, benchmarks, pricing) without a source and date attached, especially for fast-moving topics. Look it up again rather than repeating from memory in a later conversation.

## Open questions / deferred decisions

Track these as real tickets, not side comments that get lost:

- [x] #17 — Should no-match "Scheduling" emails auto-create an application, or stay manual-review-only? **Resolved: manual-review-only (closed).**
- [ ] Bare timezone abbreviations (EST/PST/etc.) resolve to literal fixed offsets, not DST-aware — acceptable for now; revisit if it causes real user-facing errors (`.ics` `TZID` parsing, tracked in #19, is the eventual proper fix).
