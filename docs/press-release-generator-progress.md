# Press Release Generator — Progress Checkpoint (2026-09-03)

End-of-day save. Development stopped for the day at the user's request — nothing new was implemented, no next AI Workspace tool was started, nothing was committed, nothing was pushed. This doc records exactly what is done, what remains uncommitted, and what the next session should pick up, so it can resume without re-deriving the history from scratch.

## Implementation (committed, `8742ac9`)

Press Release Generator — the eighth AI Workspace tool — is implemented and committed locally: `feat(ai-workspace): add press release generator`. Stage A (discovery) → Stage B (schema, service, prompt, action, job type, runner integration) → Stage C (focused integration audit, no rebuild) were each separately approved before this commit. Generate-and-review only, no Apply/Save (matching Schema Markup Generator's own precedent). Functionally complete.

## First live user test — false-failure investigation (completed, no service code changed)

The first real user test (a legitimate, detailed Storage Moguls announcement, quote/dateline/CTA left blank) produced "No valid press release could be generated from these details..." A full 11-point investigation (job row, `AiUsageLog`, health-cache TTLs, live reproduction against the real provider chain) established:

- Gemini's free-tier quota was exhausted (`QUOTA_EXCEEDED`, confirmed via `health-cache.ts`'s 10-minute unhealthy TTL — the failed job's creation time falls squarely inside that cooldown window, proving Gemini was skipped, not merely coincidentally absent from the logs).
- Generation fell back to the local `llama3.2:1b` model, which returned an anomalously short response (139 completion tokens vs. the normal ~270–300) — almost certainly empty `bodyParagraphs` and/or empty `reasoning` after cleaning.
- `buildPressReleaseResult`'s deterministic "reject, never repair" validation correctly rejected this substandard output, exactly as designed — confirmed consistent with the identical `reasoning`-required and `bodyParagraphs`-required patterns already used by Content Rewriter and Meta Tag Optimizer.
- The instruction-echo hypothesis (the user's own anti-hallucination `notes` text being confused for model output) was explicitly checked and ruled out — `INSTRUCTION_ECHO_PATTERNS` is a narrow, unrelated pattern set (meta title/description labels, character/word counts).
- **Conclusion: not a validation/service defect.** The one real (minor) issue was the UI error message, which falsely implied the user's input was insufficient.

## UI-copy fix (tested, NOT yet committed — working tree)

`features/ai-workspace/components/PressReleaseGeneratorPicker.tsx` and `features/ai-workspace/components/PressReleaseGeneratorPicker.logic.test.ts` — the null-result message was changed from "No valid press release could be generated from these details. Try adding more announcement facts and regenerating." to "The AI response didn't meet our quality requirements this time. Please try generating again.", extracted as an exported `PRESS_RELEASE_NULL_RESULT_MESSAGE` constant for direct unit testability (this repo has no component-rendering/DOM test setup). 4 new regression tests added asserting the message never implies insufficient input, missing facts, or "add more information," and asserts the exact approved wording.

Verified: focused tests 13/13 passed, AI Workspace suite 768/768 passed, full suite 2445/2445 passed, typecheck clean, lint clean (0 errors, 1 pre-existing unrelated warning in `ReportForm.tsx`), production build succeeded, migrations unchanged/up to date, diff audited — only these two files touched. **This fix is approved but not yet committed.**

## Live verification of the generator itself (completed, no code changes)

- A real successful generation was verified with quote/dateline/callToAction all left blank: those three fields correctly returned empty in the result, no fabricated content, `job.contentId` correctly null.
- A second real generation was verified with quote/dateline/callToAction all supplied: all three correctly reflected the exact supplied values (quote attributed exactly as given, not paraphrased).
- `Content` and `ContentRevision` row counts were confirmed unchanged before and after both generations — this tool never writes to those tables, matching its generate-and-review-only scope.
- Copy-to-clipboard button confirmed present and functional; no Apply/Save button present (correct, by design).

## Brand Profile grounding investigation (completed, no code changes, no architecture change)

A separate live screenshot showed the boilerplate describing "Cloud Sherpas Demo Co" instead of "Storage Moguls." Investigated and confirmed:

- `BrandProfile.companyId` is `@unique` in `prisma/schema.prisma` — Brand Profile is strictly company-level (1:1), never per-SEO-project or per-client. This is deliberate, pre-existing schema design shared identically by every AI Workspace tool, not something Press Release Generator introduced.
- The database has exactly one `Company` ("Cloud Sherpas Demo Co") and exactly one `BrandProfile`, shared across all five of that company's SEO projects. "Storage Moguls" has `clientId: null` — no backing `Client` record — so it necessarily shares the one generic demo Brand Profile.
- Retrieval path confirmed by direct code read: `dispatchPressReleaseGenerator` passes `job.companyId` (the tenant, already ownership-verified) into `generatePressRelease`, which calls `getBrandProfileByCompanyId(ctx.companyId)` — identical to every other AI Workspace tool's retrieval pattern.
- **Classification: test-data limitation, not a Press Release Generator defect.** The code is grounding exactly as designed on the only real data available. Noted (not actioned): the underlying company-level Brand Profile design would produce the same effect in a real account managing multiple genuinely distinct client brands under one tenant — a pre-existing, cross-tool architectural characteristic worth a separate, deliberate product conversation someday, not an emergency fix.
- **No architecture change was made or approved.** Brand Profile grounding remains company-level, unchanged.

## Repository state at end of day (2026-09-03)

- `git status --porcelain`:
  ```
   M features/ai-workspace/components/PressReleaseGeneratorPicker.logic.test.ts
   M features/ai-workspace/components/PressReleaseGeneratorPicker.tsx
  ?? docs/meta-tag-optimizer-progress.md
  ?? docs/phase-29-test-coverage-progress.md
  ```
- HEAD is `8742ac9` — `feat(ai-workspace): add press release generator`.
- The two modified files are exactly the UI-copy fix + its regression test described above — nothing else in the working tree was touched.
- `docs/meta-tag-optimizer-progress.md` and `docs/phase-29-test-coverage-progress.md` are separate, pre-existing, intentionally untracked files unrelated to this work. They must not be staged, modified, deleted, or committed as part of any future Press Release Generator commit.
- **No commit or push was made** during this end-of-day save. Nothing has been pushed to the remote at any point during Press Release Generator's development.

## Current stopping point

The Press Release Generator is functionally complete. The only pending repository action is to review and commit the approved UI-copy fix before moving to the next AI Workspace tool candidate. No next tool has been started or selected.
