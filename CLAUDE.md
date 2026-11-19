# Working Agreements

## Bug fixes: scope discipline

This is the default for every bug fix, not just complex ones.

- **State intended scope up front, before work starts.** Name the specific file(s) or surface(s) expected to change. If a shared dependency might need touching, flag it as a possibility in advance — don't discover it mid-diff.
- **Smallest possible fix, no refactor**, unless refactor is explicitly requested as its own task. "While I'm in here" is not a reason to touch adjacent code.
- **One surface at a time.** If a bug shows up in two places (e.g. a Today-tab card and a detail page), fix one, ship it, verify it, then decide separately whether the second needs the same fix. Don't bundle them because they look similar.
- **Investigate before editing.** Trace the actual data/control flow first. Report where root cause diverges from symptom before proposing a fix. Distinguish real bugs from by-design behavior (e.g. confidence thresholds) and from stale data (a bad row, not bad code).
- **No after-the-fact scope policing.** Once a fix is scoped and sent, let it run. Review the result against the stated scope, don't micromanage the process.
- **Document edge cases, don't chase them.** If a fix surfaces a known limitation (DST-unaware abbreviations, a UTC date-boundary edge case, an open product decision), note it and move on. Only escalate into its own ticket if it's likely to bite for real.

## Review before merge

This applies to Claude too. Self-checks (tests, type check, lint) don't count as review.

- **Every PR gets an independent review** from a reviewer that hasn't seen the work being produced: a fresh agent given only the diff and a read-only checkout. Docs-only PRs included.
- **Risky PRs get two layers: an Opus-class review and a separate Fable review**, run in parallel without seeing each other's findings. Risky means new LLM calls or prompts, substantive changes to agent instructions (CLAUDE.md, skills, prompts), auth or ownership checks, public endpoints, money or AI spend, data migrations, or changes that span several stages or services (not just several files). This overrides Escalation's default-model rule: on risky PRs the Fable review is worth the cost. If Fable can't be run, say so on the PR and leave it in draft; don't substitute another model or skip the layer.
- **Post the findings on the PR** as a comment, ranked blocking / should-fix / nit.
- **Fix or rebut each blocking finding, then get the fix reviewed.** Rerun the tests, then have one fresh reviewer (Fable on risky PRs, Opus-class otherwise) check only the fix commits against the findings. After two re-review rounds with blockers remaining, stop and ask Steve. A rebuttal goes on the PR; an unresolved dispute goes to Steve. Fix in-scope should-fix items before merge, or say on the PR why not. Should-fix items outside the PR's scope become their own tickets, per the one-surface rule.
- **Open as a draft; mark ready only after the review is posted** and nothing is blocking. Create with `draft: true` on `POST /repos/{owner}/{repo}/pulls`; mark ready with `gh pr ready` or `POST /repos/{owner}/{repo}/pulls/{n}/ccr/ready_for_review`. If drafts aren't available, prefix the title with `[needs review]` and remove it when ready.

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
