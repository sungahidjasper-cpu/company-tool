# Phase 21 Content-Quality Fixes (Rounds 1–3) — Session Checkpoint

Phase 21 (Configurable Content Brief & Long-Form Draft Generation, `e582f87`) shipped and was committed/pushed, but live testing against real generated output surfaced content-quality defects in the AI's output that the automated test suite couldn't catch (prompt-compliance/output-quality issues, not type/schema errors). This doc tracks three rounds of fixes applied against that feedback. **As of this checkpoint, Round 3 is implemented and verified but not yet committed to git** — see the checkpoint section at the bottom for the exact commit this becomes part of.

Every round holds the same hard constraints, reaffirmed each time: no change to section toggles, the CTA trust boundary, provider/fallback/retry/cost architecture, the database schema, or Phase 21's soft word-count enforcement (one generation attempt, no mechanical regenerate-until-in-range loop). No new AI tools introduced.

## Round 1 (implemented, folded into Round 2/3's PROMPT_VERSION history)

First live-generated article: 416 words against a 1500-word target, meta title leaking `"| 1500 words"` at 70 characters, meta description ~122 characters. Fixes:
- Added an explicit per-section word budget to the long-form prompt (`perSectionWords = wordCount / outlineSectionCount`) instead of a bare "approximately N words" instruction, which a weak fallback model reliably under-wrote against.
- Added a first anti-echo guardrail sentence to both prompts ("never include configuration values as literal text").
- Extended `LongFormContentReview.tsx` with the same `CounterBadge`/`checkMetaLengths` UI parity `ContentBriefReview.tsx` already had, so meta-length problems are visibly flagged in both review screens instead of only one.

Result: word count 416 → 1040 in that test; the specific "| 1500 words" leak disappeared in that run (but see Round 2 — it recurred on a later generation, proving the guardrail was probabilistic, not a guarantee).

## Round 2

A fresh live-generated article (959 words) was still not production quality. Ten defects were identified:
1. Meta title still leaking `"| 1500 words"` (Round 1's fix didn't hold on a later run).
2. Meta description still ~122 characters.
3. Length gains from repetition, not substance.
4. Outline-numbering artifacts (`1.1.`, `2.3.`) leaking into headings.
5. Factual errors — Public Storage/Extra Space Storage/CubeSmart mischaracterized as "types of storage units" rather than companies; invented statistics (10,000–15,000 cubic feet, 80–90% utilization).
6. No real H2/H3 hierarchy — a repeated generic paragraph instead.
7. Generic Key Takeaways.
8. One-word FAQ answers ("Yes").
9. Non-synthesizing conclusion.
10. Flat-string internal-link suggestions instead of structured data.

**Root-cause framing that shaped every fix since**: defects 1 and 4 are *mechanically detectable patterns* (a trailing `| N words` suffix, a leading outline-numbering prefix) — a prompt instruction can reduce their frequency but can't guarantee their absence against a weak fallback model, so they need a deterministic post-generation guarantee, not just better wording. Defects 2, 3, 5–9 are *qualitative/probabilistic* (length precision, repetition, factual accuracy, section depth, takeaway/FAQ/conclusion quality) and can't be verified in code, so they stay prompt-only per the soft-enforcement philosophy. Defect 10 was a genuine, narrow schema gap.

Fixes:
- **New `features/ai-workspace/services/content-sanitizer.ts`** — `stripConfigurationArtifacts(text)`, a pure regex pass stripping a trailing `| N words`/`(N words)`/`- N words` suffix and a leading outline-numbering prefix (`1.1.`, `2.3`, `3)`), while leaving ordinary content (`"10 Ways to..."`, numbered steps inside body prose) untouched. Wired into both services immediately after schema parsing — brief `title`/`metaTitle`/`outline`/`suggestedHeadings`/FAQ questions; long-form `introduction`/section headings/FAQ questions.
- Prompt strengthening in both services: meta-description two-sentence structure guidance; per-section "distinct information, no repetition" + sub-header instruction; a factual-boundary clause naming real company/brand names and invented statistics explicitly (added to long-form's system prompt only at this point — see Round 3 for the brief-side gap this left); stronger FAQ/Key-Takeaways/Conclusion quality bars.
- **`internalLinkPlacementSuggestions` upgraded from `string[]` to the brief's existing structured `internalLinkSchema`** (anchorText/targetPage/reason/placement/priority) in both schema files, the long-form prompt, `LongFormContentReview.tsx`'s rendering, and the two picker components' state types.
- `PROMPT_VERSION` bumped 3 → 4 in both services.

Live verification: defects 1, 4, 8, 9, 10 confirmed fixed on a real run. Defects 2, 3, 6, 7 remained soft/imperfect (expected — prompt-only fixes against a weak model). Defect 5 wasn't re-triggered in that specific run (the test brief had empty statistics/examples fields to invent from). **New finding, not yet fixed**: the model wrote its own free-form "Conclusion"/"FAQ"/"Key Takeaways"/"Resources" entries inside the open-ended `sections[]` array, in addition to correctly filling the dedicated fields — since `formatLongFormContentAsMarkdown` appends those fields unconditionally, this caused each heading to render **twice**, plus a spurious "Resources" section with a bracketed placeholder link. Flagged to the user rather than fixed, since it was outside Round 2's approved scope — became Round 3 item 1.

## Round 3

User-approved scope, four items:

**1. Prevent duplicate/reserved sections inside `sections[]`.** Added `filterReservedSections()` to `content-sanitizer.ts` — an exact-match (normalized: trim, lowercase, drop trailing punctuation — deliberately not fuzzy/substring) filter dropping any `sections[]` entry named Conclusion/FAQ/FAQs/Frequently Asked Questions/Key Takeaways/Takeaways/Resources/Additional Resources/Further Reading/References/Sources, applied after heading cleanup so a leaked `"1. Conclusion"` numbering artifact still normalizes and gets caught. Verified it does *not* strip a real heading like "Financial Resources You'll Need" (exact match only, no substring matching). The dedicated fields remain the single source of truth unconditionally, regardless of which section toggles are on. Also added a dedicated prompt bullet (split out from the already-dense H2-sections instruction into its own line, matching this file's one-instruction-per-bullet convention) telling the model never to create these sections itself.

**2. Meta title/description — verify + strengthen, no hard gate.** `checkMetaLengths` (50–60 / 150–160 chars) was already correct and fully boundary-tested (49/50/60/61, 149/150/160/161); re-verified live against real generated values (69 and 217 chars in one run, 120 and 175 in another) — both correctly flagged `TOO_LONG` in both cases, confirming the deterministic UI validation genuinely works and never silently passes an out-of-range value. Added an explicit instruction to count *only* visible reader-facing characters, never a configuration value — directly tying the original "| 1500 words" leak to why the count itself was also wrong. No regenerate-until-valid loop added.

**3. Deliberate factual-boundary live test.** Ran a dedicated brief+article generation with notes explicitly naming Public Storage, Extra Space Storage, and CubeSmart plus occupancy/pricing/market-stat concepts, with an explicit "do not invent specific numbers" instruction. Found the brief's system prompt (`content-brief.service.ts`) never had the equivalent statistic/company-name guardrail Round 2 added only to long-form's system prompt — added the same clause there (including inside FAQ answers and statistic angles, since the first factual-boundary run had invented 70–80% occupancy / $10–20/month pricing specifically inside the brief's own FAQ).

**4. No architecture expansion** — confirmed: no change to section toggles, CTA trust boundary, provider/fallback system, database schema, soft word-count enforcement, the Round 2 structured internal-link implementation, or the sanitizer's existing behavior beyond the new `filterReservedSections` addition.

`PROMPT_VERSION` bumped 4 → 5 (brief) and 4 → 5 → 6 (long-form; bumped twice within the round — once for the initial reserved-section instruction, again when it was split into its own bullet after the empty-sections investigation below).

### Round 3 live verification

Gemini's daily free-tier quota was exhausted from this session's own extensive testing (documented honestly each time it recurs, per established precedent — never worked around). All live runs fell back to the local Ollama model, **`llama3.2:1b` — a 1.2-billion-parameter model**, dramatically weaker than Gemini's flash tier. This is an environment capability ceiling worth naming explicitly: it explains a large share of the residual quality gaps below and is not a code defect.

- Reserved-section filtering: confirmed zero duplicate/reserved-name sections across every run this round.
- One run produced an empty `sections[]` with garbled introduction/conclusion field content (very short completion — 491 tokens vs. a typical 860–1880). A same-brief retry to check reproducibility instead hit Ollama request timeouts (the local server was under load from this session's own heavy testing — confirmed healthy again afterward via a direct ping). A later clean run with the refined (split-bullet) prompt produced 4 well-formed sections with no reserved-name leaks. Reads as one-off model/load flakiness rather than a reproducible regression, but couldn't be fully ruled out given the failed retry.
- Meta lengths: confirmed correctly flagged `TOO_LONG` on real generated values in every run (see item 2 above) — the model itself still doesn't reliably hit the 50–60/150–160 target (expected, soft-only), but the safety net works.
- Factual-boundary retest: the strengthened brief prompt worked for percentages/prices — no invented occupancy/pricing numbers on the retest (versus the pre-fix run's fabricated 70–80% / $10–20 figures). **The model avoided naming the specific companies (Public Storage, Extra Space Storage, CubeSmart) entirely in both factual-boundary runs**, so the "company mischaracterized as a unit type" check was never actually exercised — this remains an open verification gap, not a confirmed pass.

### New severe defect found — NOT fixed, carried into Round 4

In the factual-boundary retest, the brief's `metaTitle` field came back as **literally the instruction text itself**:

```
EXACTLY 50-60 characters (50 words, 60 characters total), meta description:
```

This is a worse instance of the same "prompt artifact leaking into content" category Round 2/3 targeted, but it's a *whole-field instruction echo*, not a trailing/leading pattern — `stripConfigurationArtifacts` doesn't catch it (it only matches an exact trailing `| N words`-style suffix or leading outline-numbering prefix), and no general pattern for "does this look like echoed instruction text" was obvious to add without risking false positives on legitimate content. Mitigating factor: `checkMetaLengths` still flagged it `TOO_LONG` (76 chars vs. the 50–60 target), so a human reviewer would see both the warning badge and the obviously-wrong text — not a silent pass. Explicitly not fixed this round; deferred to Round 4 by user instruction.

## Round 4 (completed — committed as `f531f5d`)

Fixed the metaTitle prompt-echo/content-leakage defect via a new deterministic heuristic, `looksLikeInstructionEcho()` in `content-sanitizer.ts` — detects the whole-field-is-echoed-instruction-text failure mode (distinct from `stripConfigurationArtifacts`'s narrower trailing/leading-pattern matching) and falls back to a known-good value rather than attempting any regenerate loop, preserving the soft-enforcement philosophy. Committed and pushed as part of `f531f5d fix(ai): harden content quality and reserved section filtering`.

The open verification gap noted at the time (the factual-boundary test never conclusively exercised the "real company mischaracterized as a generic unit type" failure mode against a capable provider) was later addressed in the Word-Count & Generation-Length Follow-up below, once OpenRouter/gpt-4o-mini became available as a stronger provider for testing.

## Word-Count & Generation-Length Follow-up (Phases 1–4) — session checkpoint

A separate, later thread of work than Rounds 1–4 above — same file/architecture area, different concern (the displayed word count, then the actual generated article length), using its own internal Phase 1–4 numbering. Summarized here since it's the direct continuation of this same content-generation-quality effort; full turn-by-turn detail lives in the session transcript, not duplicated here.

- **Phase 1 (investigation) → Phase 2 (implemented, committed `1959183` — `fix(ai): make long-form word count markdown-aware`)**: the displayed word count was inflated by naive whitespace-splitting counting Markdown syntax (`#`, `-`, `|`, `---`) as words. Replaced with a counter that reuses `parseMarkdownBlocks()` (the same parser Article Preview renders from) plus a word-character regex tokenizer, verified against real generated articles and 27 unit tests.
- **Phase 3 (investigation)**: traced why generated articles still fell short of their configured word-count target even after the counter fix. Root cause: `perSectionWords` was computed as if H2 sections were the entire article, with no reserved budget for intro/conclusion/FAQ, and — separately — the model appeared to treat a stated per-section *ceiling* as a practical stopping point.
- **Phase 3B (implemented, then reverted — never committed)**: first tried a deficit-corrected budget calculation; a live comparison showed it *regressed* average output versus baseline. Root-caused to the ceiling-anchoring hypothesis; reverted cleanly to the pre-Phase-3 baseline (confirmed via `git diff` against `1959183` showing zero drift) and re-tested with only the per-section ceiling phrase removed (floor math otherwise unchanged from before Phase 3). That controlled experiment validated the hypothesis — removing the stated ceiling recovered depth on both the original topic and an independent-topic validation batch — but a subsequent multi-target validation (800/1500/2500/5000) showed total-length adherence was still inconsistent, especially at the 2500/5000 tiers, and that `maxTokens` was proven not to be the limiting factor at any tier.
- **Phase 4 (implemented, verified, currently UNCOMMITTED)**: added a bounded, deficit-aware section-expansion refinement controller inside `generateLongFormContent()` — see the end-of-day checkpoint delivered in this session's final report for full detail (files, live results, known findings, git state, and the recommended first step for the next session).

**Do not re-run the Phase 1–3B investigations from scratch in a future session** — the ceiling-anchoring hypothesis and the budget-math root cause are both already established and live-verified; re-litigating them without new evidence would be redundant. Phase 4's live validation (12 real generations across all four target sizes) is the current, load-bearing evidence base for any decision about committing or further adjusting the refinement controller.

## Checkpoint status (Rounds 1–4, historical)

- Automated verification at the time: **337/337 tests passing**, typecheck clean, lint clean, production build successful.
- Round 2 + Round 3 + Round 4 work was committed (see `f531f5d` and the roadmap doc for exact hashes); Round 4 was pushed as part of that commit.
