import "dotenv/config";

import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

/**
 * Fixed IDs make every upsert idempotent — re-running this script never
 * creates duplicates, it just re-affirms the same rows (and updates them if
 * a field here changes). Real app data uses uuid(7) defaults; seed data
 * intentionally overrides that with stable, well-known IDs instead.
 */
const IDS = {
  company: "00000000-0000-0000-0000-000000000001",
  superAdmin: "00000000-0000-0000-0000-000000000002",
  manager: "00000000-0000-0000-0000-000000000003",
  employeeOne: "00000000-0000-0000-0000-000000000004",
  employeeTwo: "00000000-0000-0000-0000-000000000005",
  clientOne: "00000000-0000-0000-0000-000000000006",
  clientTwo: "00000000-0000-0000-0000-000000000007",
  projectOne: "00000000-0000-0000-0000-000000000008",
  projectTwo: "00000000-0000-0000-0000-000000000009",
  seoProject: "00000000-0000-0000-0000-00000000000a",
  keywordCluster: "00000000-0000-0000-0000-00000000000b",
  keywordOne: "00000000-0000-0000-0000-00000000000c",
  keywordTwo: "00000000-0000-0000-0000-00000000000d",
  keywordThree: "00000000-0000-0000-0000-00000000000e",
  contentOne: "00000000-0000-0000-0000-00000000000f",
  contentTwo: "00000000-0000-0000-0000-000000000010",
  websiteAnalysisJob: "00000000-0000-0000-0000-000000000011",
} as const;

const SEED_PASSWORD = "ChangeMe123!";

/** Realistic, fully-shaped example of a completed Website Analysis result — matches WebsiteAnalysisResult/SeoAuditResultData in features/seo/schemas/seo-audit.schema.ts. */
function buildWebsiteAnalysisResult() {
  const scoreWithReasoning = (score: number, reasoning: string) => ({ score, reasoning });

  return {
    businessCategory: "Plumbing & HVAC services",
    services: ["Emergency plumbing repair", "Water heater installation", "HVAC maintenance", "Drain cleaning"],
    locations: ["Austin, TX", "Round Rock, TX"],
    topics: ["Plumbing maintenance tips", "Emergency repair guides", "Seasonal HVAC care"],
    crawledPages: [
      { url: "https://acme-plumbing.example.com/", title: "Acme Plumbing & HVAC | 24/7 Emergency Service" },
      { url: "https://acme-plumbing.example.com/services", title: "Our Services | Acme Plumbing & HVAC" },
      { url: "https://acme-plumbing.example.com/contact", title: "Contact Us | Acme Plumbing & HVAC" },
    ],
    sitemapUrlCount: 12,
    warnings: [],
    overallScore: 68,
    audit: {
      overallScore: 68,
      categoryScores: {
        technicalSeo: scoreWithReasoning(74, "HTTPS enforced site-wide and a valid robots.txt/sitemap.xml exist, but 2 of 3 sampled pages are missing canonical tags."),
        onPageSeo: scoreWithReasoning(61, "Titles and meta descriptions are present on the homepage but missing on the services page; H1 usage is consistent."),
        contentQuality: scoreWithReasoning(65, "Service pages describe offerings clearly but lack depth (no FAQs, no pricing guidance, no customer proof)."),
        structuredData: scoreWithReasoning(40, "No Organization, LocalBusiness, or Service schema detected anywhere on the site."),
        internalLinking: scoreWithReasoning(70, "Homepage links to all major sections; the contact page is not linked from the services page."),
        eeat: {
          score: 58,
          reasoning: "Some experience signals (project photos) exist but no named technicians, licenses, or reviews are surfaced on-site.",
          factors: [
            { name: "Experience", score: 62, reasoning: "Before/after project photos are shown, but with no dates or context." },
            { name: "Expertise", score: 55, reasoning: "No licensing/certification numbers displayed anywhere." },
            { name: "Authoritativeness", score: 50, reasoning: "No mentions, backlinks, or third-party citations evident." },
            { name: "Trustworthiness", score: 65, reasoning: "Phone number and address are clearly listed, but no reviews or testimonials." },
          ],
        },
        localSeo: {
          applicable: true,
          score: 63,
          reasoning: "Serves two named metro-area cities but has no dedicated location pages and no visible LocalBusiness schema.",
        },
        geoReadiness: {
          score: 52,
          reasoning: "Entities (services, locations) are named in prose but never formally structured, limiting AI-search extractability.",
          factors: [
            { name: "Entity Clarity", score: 60, reasoning: "Services are named clearly in headings and body copy." },
            { name: "Structured Data Coverage", score: 30, reasoning: "No schema markup of any kind was detected." },
            { name: "Topic Clustering", score: 55, reasoning: "Content touches related topics but isn't organized into clusters." },
            { name: "Semantic Consistency", score: 58, reasoning: "Terminology for services is consistent across pages." },
            { name: "Authoritativeness", score: 50, reasoning: "No external validation signals found in the crawl." },
            { name: "Source Transparency", score: 55, reasoning: "Business identity is clear but sourcing/credentials are not." },
            { name: "Internal Entity Relationships", score: 56, reasoning: "Services and locations are mentioned together but not explicitly linked." },
          ],
        },
        aeoReadiness: {
          score: 45,
          reasoning: "No content is formatted for direct-answer extraction — no FAQs, no Q&A headings, no definition lists.",
          factors: [
            { name: "FAQ Content", score: 20, reasoning: "No FAQ section exists on any crawled page." },
            { name: "Question & Answer Formatting", score: 25, reasoning: "No content uses question-style headings." },
            { name: "Featured Snippet Opportunities", score: 40, reasoning: "Service descriptions are prose paragraphs, not scannable lists." },
            { name: "Definitions", score: 35, reasoning: "Industry terms (e.g. \"hydro-jetting\") are used without being defined." },
            { name: "Tables", score: 30, reasoning: "No comparison or pricing tables were found." },
            { name: "Lists", score: 55, reasoning: "The services page uses a bulleted list of offerings." },
            { name: "Direct Answers", score: 50, reasoning: "The homepage states service areas plainly near the top of the page." },
          ],
        },
      },
      recommendations: [
        {
          title: "Add Organization and LocalBusiness JSON-LD",
          description: "No structured data was detected anywhere on the site.",
          whyItMatters: "Structured data helps search and AI engines correctly attribute business identity, service area, and contact details.",
          estimatedImpact: "HIGH" as const,
          difficulty: "EASY" as const,
          priority: "HIGH" as const,
          category: "STRUCTURED_DATA" as const,
        },
        {
          title: "Build a dedicated FAQ page",
          description: "Common customer questions (pricing, response time, service area) aren't answered anywhere on-site.",
          whyItMatters: "FAQ content is the single highest-leverage format for both featured snippets and AI-answer-engine extraction.",
          estimatedImpact: "HIGH" as const,
          difficulty: "MEDIUM" as const,
          priority: "HIGH" as const,
          category: "CONTENT_QUALITY" as const,
        },
        {
          title: "Add canonical tags to the services and contact pages",
          description: "Only the homepage has a canonical tag; the other two sampled pages are missing one.",
          whyItMatters: "Missing canonical tags risk duplicate-content ambiguity as the site grows.",
          estimatedImpact: "MEDIUM" as const,
          difficulty: "EASY" as const,
          priority: "MEDIUM" as const,
          category: "TECHNICAL_SEO" as const,
        },
      ],
      keywordIntelligence: {
        primaryKeywords: ["emergency plumber Austin", "HVAC maintenance Round Rock", "water heater installation"],
        secondaryKeywords: ["drain cleaning service", "24/7 plumbing repair", "residential HVAC service"],
        longTailKeywords: ["how much does emergency plumbing cost in Austin", "best time to service HVAC before summer"],
        semanticKeywords: ["burst pipe repair", "furnace tune-up", "water heater replacement cost"],
        searchIntentSummary: "Most relevant queries are local-service, high-intent searches from homeowners with an active problem (emergency plumbing) or a seasonal maintenance need (HVAC tune-ups) — both favor pages with fast, direct answers over long-form content.",
        contentClusters: [
          { clusterName: "Emergency plumbing", keywords: ["burst pipe repair", "emergency plumber Austin", "24/7 plumbing repair"] },
          { clusterName: "HVAC seasonal maintenance", keywords: ["HVAC maintenance Round Rock", "furnace tune-up", "best time to service HVAC"] },
        ],
      },
      contentGaps: [
        {
          title: "Pricing / cost guide page",
          description: "No page addresses typical service costs.",
          reasoning: "Cost is one of the most common pre-purchase questions for home-service businesses and currently sends visitors to competitors' comparison content.",
        },
        {
          title: "Location-specific landing pages",
          description: "Austin and Round Rock are both served but neither has a dedicated page.",
          reasoning: "Location pages let each served area rank independently and let the AEO/GEO layer disambiguate service area explicitly.",
        },
      ],
      structuredDataRecommendations: [
        {
          schemaType: "LocalBusiness",
          reasoning: "No LocalBusiness schema exists; this is the highest-priority missing schema type for a service-area business.",
          exampleJsonLd: JSON.stringify(
            {
              "@context": "https://schema.org",
              "@type": "Plumber",
              name: "Acme Plumbing & HVAC",
              areaServed: ["Austin, TX", "Round Rock, TX"],
              telephone: "+1-512-555-0100",
            },
            null,
            2
          ),
        },
      ],
      detectedSchemaTypes: [],
      internalLinkingSuggestions: [
        {
          title: "Link the contact page from the services page",
          description: "Visitors reading about a service have no direct path to the contact page from that page.",
          type: "RELATED_PAGES" as const,
        },
      ],
      orphanPages: [],
      executiveSummary: {
        overallHealthNarrative: "Acme Plumbing & HVAC has solid technical fundamentals (HTTPS, sitemap, consistent headings) but is missing nearly every layer that helps AI search and answer engines understand and recommend the business — no structured data, no FAQ content, and no location-specific pages for either city it serves.",
        strengths: ["HTTPS enforced site-wide", "Clear, consistent H1 usage", "Homepage links to all major sections"],
        weaknesses: ["No structured data of any kind", "No FAQ or Q&A-formatted content", "No location-specific landing pages", "Missing canonical tags on 2 of 3 sampled pages"],
        topActions: ["Add Organization + LocalBusiness JSON-LD", "Build a dedicated FAQ page", "Add canonical tags to remaining pages", "Create Austin and Round Rock location pages", "Add customer reviews/testimonials for EEAT"],
      },
    },
  };
}

async function main() {
  console.log("Seeding database...");

  const company = await prisma.company.upsert({
    where: { id: IDS.company },
    update: {},
    create: {
      id: IDS.company,
      name: "Cloud Sherpas Demo Co",
      slug: "cloud-sherpas-demo",
      industry: "Technology Consulting",
      website: "https://example.com",
      timezone: "America/Chicago",
    },
  });

  const superAdminPasswordHash = await hashPassword(SEED_PASSWORD);
  const superAdmin = await prisma.user.upsert({
    where: { id: IDS.superAdmin },
    update: {},
    create: {
      id: IDS.superAdmin,
      companyId: company.id,
      email: "superadmin@demo.cloudsherpas.test",
      firstName: "Sasha",
      lastName: "Admin",
      passwordHash: superAdminPasswordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: new Date(0),
    },
  });

  const managerPasswordHash = await hashPassword(SEED_PASSWORD);
  const manager = await prisma.user.upsert({
    where: { id: IDS.manager },
    update: {},
    create: {
      id: IDS.manager,
      companyId: company.id,
      email: "manager@demo.cloudsherpas.test",
      firstName: "Morgan",
      lastName: "Manager",
      passwordHash: managerPasswordHash,
      role: "MANAGER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(0),
    },
  });

  const employeePasswordHash = await hashPassword(SEED_PASSWORD);
  const [employeeOne, employeeTwo] = await Promise.all([
    prisma.user.upsert({
      where: { id: IDS.employeeOne },
      update: {},
      create: {
        id: IDS.employeeOne,
        companyId: company.id,
        email: "employee1@demo.cloudsherpas.test",
        firstName: "Erin",
        lastName: "Employee",
        passwordHash: employeePasswordHash,
        role: "EMPLOYEE",
        status: "ACTIVE",
        emailVerifiedAt: new Date(0),
      },
    }),
    prisma.user.upsert({
      where: { id: IDS.employeeTwo },
      update: {},
      create: {
        id: IDS.employeeTwo,
        companyId: company.id,
        email: "employee2@demo.cloudsherpas.test",
        firstName: "Evan",
        lastName: "Employee",
        passwordHash: employeePasswordHash,
        role: "EMPLOYEE",
        status: "ACTIVE",
        emailVerifiedAt: new Date(0),
      },
    }),
  ]);

  const [clientOne, clientTwo] = await Promise.all([
    prisma.client.upsert({
      where: { id: IDS.clientOne },
      update: {},
      create: {
        id: IDS.clientOne,
        companyId: company.id,
        ownerId: manager.id,
        name: "Acme Plumbing & HVAC",
        email: "ops@acme-plumbing.example.com",
        industry: "Home Services",
        website: "https://acme-plumbing.example.com",
        phone: "+1-512-555-0100",
        status: "ACTIVE",
        source: "Referral",
      },
    }),
    prisma.client.upsert({
      where: { id: IDS.clientTwo },
      update: {},
      create: {
        id: IDS.clientTwo,
        companyId: company.id,
        ownerId: manager.id,
        name: "Northside Dental Group",
        email: "info@northsidedental.example.com",
        industry: "Healthcare",
        website: "https://northsidedental.example.com",
        status: "LEAD",
        source: "Inbound",
      },
    }),
  ]);

  await Promise.all([
    prisma.project.upsert({
      where: { id: IDS.projectOne },
      update: {},
      create: {
        id: IDS.projectOne,
        companyId: company.id,
        clientId: clientOne.id,
        ownerId: manager.id,
        name: "Acme Website Rebuild",
        description: "Rebuild the marketing site and integrate the new SEO workspace.",
        status: "IN_PROGRESS",
        priority: "HIGH",
        assignedUsers: { connect: [{ id: employeeOne.id }] },
      },
    }),
    prisma.project.upsert({
      where: { id: IDS.projectTwo },
      update: {},
      create: {
        id: IDS.projectTwo,
        companyId: company.id,
        clientId: clientTwo.id,
        ownerId: manager.id,
        name: "Northside Dental Onboarding",
        description: "Initial discovery and proposal for Northside Dental.",
        status: "PLANNING",
        priority: "MEDIUM",
        assignedUsers: { connect: [{ id: employeeTwo.id }] },
      },
    }),
  ]);

  const seoProject = await prisma.sEOProject.upsert({
    where: { id: IDS.seoProject },
    update: {},
    create: {
      id: IDS.seoProject,
      companyId: company.id,
      clientId: clientOne.id,
      ownerId: manager.id,
      name: "Acme Plumbing SEO",
      domain: "acme-plumbing.example.com",
      status: "ACTIVE",
    },
  });

  const keywordCluster = await prisma.keywordCluster.upsert({
    where: { id: IDS.keywordCluster },
    update: {},
    create: {
      id: IDS.keywordCluster,
      seoProjectId: seoProject.id,
      name: "Emergency plumbing",
      description: "High-intent, high-urgency plumbing searches.",
    },
  });

  await Promise.all([
    prisma.keyword.upsert({
      where: { id: IDS.keywordOne },
      update: {},
      create: {
        id: IDS.keywordOne,
        seoProjectId: seoProject.id,
        clusterId: keywordCluster.id,
        ownerId: employeeOne.id,
        term: "emergency plumber austin",
        searchVolume: 1200,
        difficulty: 42,
        currentRank: 8,
        intent: "TRANSACTIONAL",
        priority: "HIGH",
        status: "IN_PROGRESS",
      },
    }),
    prisma.keyword.upsert({
      where: { id: IDS.keywordTwo },
      update: {},
      create: {
        id: IDS.keywordTwo,
        seoProjectId: seoProject.id,
        clusterId: keywordCluster.id,
        ownerId: employeeOne.id,
        term: "water heater installation cost",
        searchVolume: 900,
        difficulty: 35,
        intent: "COMMERCIAL",
        priority: "MEDIUM",
        status: "NOT_STARTED",
      },
    }),
    prisma.keyword.upsert({
      where: { id: IDS.keywordThree },
      update: {},
      create: {
        id: IDS.keywordThree,
        seoProjectId: seoProject.id,
        term: "hvac maintenance round rock",
        searchVolume: 400,
        difficulty: 28,
        intent: "COMMERCIAL",
        priority: "MEDIUM",
        status: "NOT_STARTED",
      },
    }),
  ]);

  await Promise.all([
    prisma.content.upsert({
      where: { id: IDS.contentOne },
      update: {},
      create: {
        id: IDS.contentOne,
        seoProjectId: seoProject.id,
        authorId: employeeOne.id,
        title: "Emergency Plumbing FAQ",
        status: "PUBLISHED",
        publishedAt: new Date("2026-06-01"),
        keywords: { connect: [{ id: IDS.keywordOne }] },
      },
    }),
    prisma.content.upsert({
      where: { id: IDS.contentTwo },
      update: {},
      create: {
        id: IDS.contentTwo,
        seoProjectId: seoProject.id,
        authorId: employeeOne.id,
        title: "How Much Does a Water Heater Installation Cost?",
        status: "DRAFT",
        keywords: { connect: [{ id: IDS.keywordTwo }] },
      },
    }),
  ]);

  const websiteAnalysisResult = buildWebsiteAnalysisResult();
  await prisma.websiteAnalysisJob.upsert({
    where: { id: IDS.websiteAnalysisJob },
    update: {},
    create: {
      id: IDS.websiteAnalysisJob,
      seoProjectId: seoProject.id,
      companyId: company.id,
      domain: "acme-plumbing.example.com",
      status: "SUCCEEDED",
      progress: 100,
      overallScore: websiteAnalysisResult.overallScore,
      resultJson: websiteAnalysisResult,
    },
  });

  console.log("Seed complete:");
  console.log(`  Company: ${company.name} (${company.slug})`);
  console.log(`  Super Admin: ${superAdmin.email} / ${SEED_PASSWORD}`);
  console.log(`  Manager:     manager@demo.cloudsherpas.test / ${SEED_PASSWORD}`);
  console.log(`  Employees:   employee1@demo.cloudsherpas.test, employee2@demo.cloudsherpas.test / ${SEED_PASSWORD}`);
  console.log(`  Clients: ${clientOne.name}, ${clientTwo.name}`);
  console.log(`  SEO Project: ${seoProject.name} (${seoProject.domain})`);
  console.log(`  Website Analysis: 1 completed example (score ${websiteAnalysisResult.overallScore}/100)`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
