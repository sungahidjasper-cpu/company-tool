/**
 * Compass's own distillation of the org's SEO/GEO/AEO writing standard into
 * a single reusable system-prompt clause — not the source document copied
 * verbatim. Shared by content-brief.service.ts and long-form-content.service.ts
 * so both tasks are held to the same standard from one place, rather than
 * two prompts drifting apart over time. Each service still layers its own
 * task-specific requirements (word count, section toggles, FAQ style, the
 * anti-invention/anti-leak clauses) on top of this — this constant only
 * carries the general writing-quality doctrine, not those mechanics.
 */
/**
 * Phase B B5.2 — the shared SEO-metric/competitor grounding guard.
 *
 * None of the AI Workspace tools receive analytics, Search Console, rank
 * tracking, backlink or competitor data — the Keyword table's own
 * searchVolume/difficulty/currentRank columns are never passed into any
 * prompt. A tool must therefore never imply it has access to numbers it was
 * never given. Content Gap Analysis already carried its own tailored version
 * of this rule (kept as-is, since it also names the specific data its audit
 * genuinely does supply); this is the same protection expressed once for the
 * tools that had none.
 *
 * Deliberately additive: each service keeps its own task-specific
 * anti-invention clauses, and this only closes the metric/competitor gap.
 */
export const SEO_METRIC_GROUNDING_GUARD =
  "Grounding limits on SEO data: you have NOT been given any analytics, rank-tracking, Search Console, backlink, or competitor data. Never state or imply a search volume, keyword ranking or SERP position, traffic or visit count, click count, impression count, click-through rate, conversion rate, backlink count, keyword difficulty score, or any analytics trend — any such figure or comparison would be fabricated. Never claim what a competitor ranks for, what content a competitor has published, or how a competitor performs; no competitor dataset has been supplied, and a competitor's URL alone is not evidence of their performance. Justify every recommendation from what is actually present in the supplied context, and phrase it as a recommendation rather than as a measured result.";

export const CONTENT_QUALITY_DOCTRINE =
  "Content-quality standard: accuracy, clarity, and usefulness to the reader always outrank SEO formatting — never trade a correct statement for a punchier one. Give the reader a useful answer to their main question early, not a slow warm-up. Where you make an important claim, prefer stating the point plainly, grounding it in whatever specific detail the supplied context actually provides, then explaining what it means for the reader — never manufacture evidence just to fill that shape. Every section must add information, analysis, or a concrete implication that no other section already covers; never restate the same point in new words just to fill an outline slot, and never turn an outline point into a visible numbered fragment or a bare question-and-one-line-answer — the outline is planning structure for you alone, not text the reader sees. Write like a knowledgeable person talking to a reader, not a checklist being read aloud — integrate keywords and structure naturally, never by force. Keep an established fact, a sourced claim, your own analysis, and an opinion visibly distinct from one another — never state analysis or an estimate as if it were settled fact. Never invent a statistic, source, quote, credential, testimonial, case study, or personal anecdote.";
