import type { BrandProfile } from "@/lib/generated/prisma/client";
import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import type { StreamEvent } from "@/lib/ai/providers/types";
import { schemaMarkupOutputSchema, type SchemaMarkupOutput } from "@/features/ai-workspace/schemas/schema-markup-generator.schema";
import { CONTENT_QUALITY_DOCTRINE } from "@/features/ai-workspace/services/content-quality-doctrine";
import { getBrandProfileByCompanyId } from "@/features/companies/services/brand-profile.service";

/**
 * Bumped whenever the prompt template below changes — same convention as
 * content-brief.service.ts's PROMPT_VERSION.
 * v2 — live verification found the model sometimes returned a bare
 * URL/comment for exampleJsonLd instead of an actual JSON-LD object,
 * despite the v1 prose instruction; added a literal example to the prompt
 * to make the required shape unambiguous.
 * v3 — STEP 9/10 audit+remediation: two independent, confirmed defects —
 * (1) exampleJsonLd had no deterministic format guarantee (see
 * isValidJsonLd below), and (2) the prompt never told the model to OMIT a
 * schema type when the supplied context lacks evidence for it, so it
 * would guess (hedged reasoning like "may contain"/"is likely to") and
 * sometimes fabricate example entities (e.g. an invented product name for
 * a business with no supplied product data). Rewrote the anti-fabrication
 * and evidence-only instructions accordingly.
 */
export const PROMPT_VERSION = 3;

/**
 * Live verification against the local Ollama fallback (engaged when Gemini
 * was transiently unavailable) found 2000 was too tight once the model
 * writes 5 real reasoning strings AND 5 full JSON-LD objects — it
 * consistently truncated every exampleJsonLd to a bare "{" after spending
 * its budget on reasoning first. Matches content-brief.service.ts's own
 * budget for a similarly-shaped multi-item structured response.
 */
const MAX_OUTPUT_TOKENS = 3000;

export const SCHEMA_MARKUP_SYSTEM_PROMPT = `${CONTENT_QUALITY_DOCTRINE} You are a technical SEO specialist producing schema.org structured-data (JSON-LD) recommendations. Accuracy is more important than the number of recommendations — fewer, well-supported recommendations are better than more, speculative ones.

Recommend a schema type ONLY when the supplied context contains specific evidence supporting it. If the evidence for a type is insufficient, OMIT that type entirely rather than including it "just in case" or because it could theoretically help SEO. Never recommend a type merely because businesses of this general kind often use it.

Concretely: never recommend Product unless the supplied context identifies an actual, named product or service; never recommend LocalBusiness unless the supplied context provides real business/location evidence; never recommend FAQPage unless actual question-and-answer content is present in the supplied context; never recommend Article unless the supplied page is actually an article with identifiable article content; never default to Organization as a generic fallback when the supplied context doesn't describe a real organizational entity or when another type fits the actual page better.

Never invent a product, service, entity, author, publisher, date, price, rating, review, testimonial, certification, award, location, URL, organization detail, business detail, or any other factual value not explicitly present in the supplied context. Every exampleJsonLd must use only facts explicitly available in the supplied context above. If a schema type would require a field you have no supported value for, either omit that schema recommendation entirely, or include only the fields you do have real support for (the supplied website domain may be used as an entity's url, since that is a real, already-supplied fact — never invent a different or more specific URL). Never fill a required-looking field with a placeholder that could be mistaken for real production data.

State each recommendation's reasoning as a direct connection to something actually present in the supplied context — never speculative phrasing like "may contain," "is likely to," "could potentially," or "might have." If you would need speculative phrasing to justify a recommendation, that is a sign the evidence is insufficient and the recommendation should be omitted instead.

Every exampleJsonLd must be syntactically valid JSON-LD — a proper "@context"/"@type" object, not prose describing one.`;

export type SchemaMarkupContext = {
  /** Provenance for the AiUsageLog row. */
  seoProjectId: string;
  /** Phase 19 — required for enforceCompanyAiLimits. */
  companyId: string;
  seoProjectName: string;
  domain: string;
  /** Present when the request is grounded in one specific existing page rather than the business in general. */
  content?: { title: string; metaDescription: string | null; url: string | null } | null;
  notes?: string;
};

/**
 * ctx.notes is raw, unsanitized user text interpolated directly below — the
 * same accepted-risk trust boundary content-brief.service.ts's buildPrompt
 * documents: nothing generated from it is ever persisted (this tool never
 * writes to the database at all, see the actions file), and the system
 * prompt above already instructs the model not to invent facts.
 */
export function buildPrompt(ctx: SchemaMarkupContext, brandProfile?: BrandProfile | null): string {
  const lines: string[] = [`Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})`];

  if (ctx.content) {
    lines.push(`Target page: "${ctx.content.title}"${ctx.content.url ? ` (${ctx.content.url})` : ""}`);
    if (ctx.content.metaDescription) lines.push(`Page description: ${ctx.content.metaDescription}`);
  } else {
    lines.push("No specific existing page was selected — recommend schema markup appropriate for this business/website in general.");
  }

  if (brandProfile?.brandName) lines.push(`Brand name: ${brandProfile.brandName}.`);
  if (brandProfile?.productsServices) lines.push(`Products/services: ${brandProfile.productsServices}.`);
  if (brandProfile?.targetAudience) lines.push(`Target audience: ${brandProfile.targetAudience}.`);
  if (brandProfile?.targetCountry) lines.push(`Target country/market: ${brandProfile.targetCountry}.`);

  if (ctx.notes) lines.push(`Additional context from the requester: ${ctx.notes}`);

  return `${lines.join("\n")}

Using ONLY the information above, recommend up to 5 schema.org structured-data types this page/business should use — fewer is fine, and zero is an acceptable answer if nothing above is well-supported enough. For each one you DO include, provide:
1. schemaType: the schema.org type name (e.g. "Organization", "LocalBusiness", "FAQPage", "Product", "Article").
2. reasoning: one or two sentences pointing to the SPECIFIC information above that justifies this type — not generic advice, and not speculative wording ("may," "likely," "could," "might").
3. exampleJsonLd: a complete, syntactically valid JSON-LD example, grounded strictly in the information above. This must be actual JSON — a "@context"/"@type" object, e.g. exactly this shape (with your own real field values, not this literal example): {"@context":"https://schema.org","@type":"Organization","name":"Business Name","url":"https://example.com/your-page-url"}. It must NEVER be a bare URL, a comment, or a sentence describing what the JSON-LD would contain — it must be the actual serialized object, starting with { and ending with }. Include only fields you have real supplied information for; omit any field (or the whole recommendation) rather than inventing a value.

Before finalizing, re-check every recommendation against the information above: if you cannot point to a specific supplied fact that justifies the schema type or a field's value, remove that recommendation or that field rather than guessing.

Never include internal instructions, configuration labels, or any other generation parameter as literal text anywhere in a schemaType or reasoning field.`;
}

/**
 * Deterministic validator for a single exampleJsonLd string — the same
 * principle content-sanitizer.ts's functions apply to prose fields
 * ("prompt wording measurably reduces a defect but cannot mathematically
 * guarantee it against a small/weak fallback model"), applied here to
 * structural JSON-LD validity instead of text artifacts. This never
 * repairs or mutates the value — a malformed string is rejected outright,
 * never patched into something that merely looks valid. Deliberately
 * lightweight: it checks the shape a real JSON-LD object must have
 * (parseable JSON, a plain object, "@context" and "@type" present), not
 * full schema.org conformance — see this file's own PROMPT_VERSION 3
 * comment and the service's exported comment for why deeper semantic
 * grounding is a prompt concern, not a runtime validator's job.
 */
export function isValidJsonLd(value: string): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;

  const obj = parsed as Record<string, unknown>;
  return "@context" in obj && "@type" in obj;
}

/**
 * Mirrors content-brief.service.ts's one-function-per-task pattern exactly:
 * a thin prompt-builder around the shared generateStructuredOutput
 * orchestrator. No changes to lib/ai/providers/* — this is still a
 * schema-validated JSON call like every existing AI Workspace task.
 *
 * Deliberately does not consume Knowledge Source context — citation
 * grounding matters far less for structured-data type/field recommendations
 * than for a full brief or article, and the smaller surface keeps this
 * first version of the tool minimal. Brand Profile IS consumed (see
 * buildPrompt above) since its fields map directly onto common schema.org
 * fields (Organization.name, LocalBusiness.areaServed, etc.).
 *
 * Every recommendation whose exampleJsonLd fails isValidJsonLd is dropped
 * here, before the result is ever returned to the runner/UI — a filtered,
 * not repaired, result, so nothing downstream (the job's resultJson, the
 * "Copy JSON-LD" button) can ever present malformed JSON-LD as copy-ready.
 * An all-invalid response degrades to an empty recommendations array,
 * which the existing UI already renders as "no recommendations were
 * returned" — no new failure state needed.
 */
export async function generateSchemaMarkupRecommendations(ctx: SchemaMarkupContext, onChunk?: (event: StreamEvent) => void): Promise<SchemaMarkupOutput> {
  // Fetched here, not in the job runner or the action layer — same
  // service-internal-fetch precedent as content-brief.service.ts and
  // long-form-content.service.ts. ctx.companyId is already trusted (derived
  // from the authenticated actor at job-creation time).
  const brandProfile = await getBrandProfileByCompanyId(ctx.companyId);
  const options = {
    system: SCHEMA_MARKUP_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx, brandProfile),
    maxTokens: MAX_OUTPUT_TOKENS,
    taskType: "SCHEMA_MARKUP_GENERATION" as const,
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  };
  const result = onChunk
    ? await generateStructuredOutputStreaming(schemaMarkupOutputSchema, options, onChunk)
    : await generateStructuredOutput(schemaMarkupOutputSchema, options);
  const parsed = schemaMarkupOutputSchema.parse(result);
  return {
    recommendations: parsed.recommendations.filter((recommendation) => isValidJsonLd(recommendation.exampleJsonLd)),
  };
}
