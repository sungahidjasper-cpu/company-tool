import { describe, expect, it } from "vitest";

import { SEO_METRIC_GROUNDING_GUARD } from "@/features/ai-workspace/services/content-quality-doctrine";
import { CONTENT_BRIEF_SYSTEM_PROMPT } from "@/features/ai-workspace/services/content-brief.service";
import { SCHEMA_MARKUP_SYSTEM_PROMPT } from "@/features/ai-workspace/services/schema-markup-generator.service";
import { INTERNAL_LINK_ANALYZER_SYSTEM_PROMPT } from "@/features/ai-workspace/services/internal-link-analyzer.service";
import { SOCIAL_SNIPPET_GENERATOR_SYSTEM_PROMPT } from "@/features/ai-workspace/services/social-snippet-generator.service";
import { META_TAG_OPTIMIZER_SYSTEM_PROMPT } from "@/features/ai-workspace/services/meta-tag-optimizer.service";
import { CONTENT_REWRITER_SYSTEM_PROMPT } from "@/features/ai-workspace/services/content-rewriter.service";
import { PRESS_RELEASE_GENERATOR_SYSTEM_PROMPT } from "@/features/ai-workspace/services/press-release-generator.service";
import { CONTENT_GAP_ANALYSIS_SYSTEM_PROMPT } from "@/features/ai-workspace/services/content-gap-analysis.service";

/**
 * Phase B B5.2 — no AI Workspace tool receives analytics, rank-tracking,
 * Search Console, backlink or competitor data. The Keyword table does carry
 * searchVolume/difficulty/currentRank columns, but those are never passed
 * into any prompt, so a tool asserting such a figure would be fabricating it.
 *
 * Content Gap Analysis already had its own tailored guard and keeps it — it
 * additionally names the data its audit genuinely does supply. Long-Form is
 * covered too but is not asserted here: its system prompt is a private const
 * (not exported), and exporting it purely for a test would change the
 * service's public surface for no runtime benefit; its guard is verified by
 * the shared-constant checks below plus the service's own prompt tests.
 */
const GUARDED_PROMPTS: ReadonlyArray<readonly [string, string]> = [
  ["Content Brief", CONTENT_BRIEF_SYSTEM_PROMPT],
  ["Schema Markup Generator", SCHEMA_MARKUP_SYSTEM_PROMPT],
  ["Internal Link Analyzer", INTERNAL_LINK_ANALYZER_SYSTEM_PROMPT],
  ["Social Snippet Generator", SOCIAL_SNIPPET_GENERATOR_SYSTEM_PROMPT],
  ["Meta Tag Optimizer", META_TAG_OPTIMIZER_SYSTEM_PROMPT],
  ["Content Rewriter", CONTENT_REWRITER_SYSTEM_PROMPT],
  ["Press Release Generator", PRESS_RELEASE_GENERATOR_SYSTEM_PROMPT],
];

describe("B5.2 — SEO metric/competitor grounding guard", () => {
  it("the shared guard names every unsupported metric class", () => {
    for (const term of [
      "search volume",
      "keyword ranking",
      "SERP position",
      "traffic",
      "click",
      "impression",
      "click-through rate",
      "conversion rate",
      "backlink count",
      "keyword difficulty",
      "analytics",
    ]) {
      expect(SEO_METRIC_GROUNDING_GUARD.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  it("the shared guard forbids competitor performance claims and rejects a bare competitor URL as evidence", () => {
    expect(SEO_METRIC_GROUNDING_GUARD).toMatch(/never claim what a competitor ranks for/i);
    expect(SEO_METRIC_GROUNDING_GUARD).toMatch(/URL alone is not evidence/i);
  });

  it("the shared guard requires recommendations to be phrased as recommendations, not measured results", () => {
    expect(SEO_METRIC_GROUNDING_GUARD).toMatch(/rather than as a measured result/i);
  });

  for (const [tool, prompt] of GUARDED_PROMPTS) {
    it(`${tool}: carries the shared grounding guard`, () => {
      expect(prompt).toContain(SEO_METRIC_GROUNDING_GUARD);
    });

    it(`${tool}: still carries the shared content-quality doctrine (guard is additive, not a replacement)`, () => {
      expect(prompt).toMatch(/Content-quality standard/);
    });
  }

  it("Content Gap Analysis keeps its own tailored guard rather than duplicating the shared one", () => {
    expect(CONTENT_GAP_ANALYSIS_SYSTEM_PROMPT).not.toContain(SEO_METRIC_GROUNDING_GUARD);
    expect(CONTENT_GAP_ANALYSIS_SYSTEM_PROMPT).toMatch(/never state or imply anything about a competitor/i);
    expect(CONTENT_GAP_ANALYSIS_SYSTEM_PROMPT).toMatch(/search volume, keyword ranking, keyword difficulty, or website-traffic/i);
  });
});
