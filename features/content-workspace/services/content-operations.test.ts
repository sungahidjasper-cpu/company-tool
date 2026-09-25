import { describe, expect, it } from "vitest";

import {
  UNAVAILABLE_OPERATIONS,
  buildContentOperations,
  describeContentIdentity,
  describeOperationsUnavailable,
  workspaceSelectionForContent,
  type ContentOperationKey,
  type ContentOperationsInput,
} from "@/features/content-workspace/services/content-operations";

const BASE: ContentOperationsInput = {
  seoProjectId: "project-a",
  contentId: "content-1",
  canManage: true,
  contentDeletedAt: null,
  projectDeletedAt: null,
  body: "<p>A real article body.</p>",
  workflowStage: "HAS_ARTICLE",
};

const flatten = (input: ContentOperationsInput) => buildContentOperations(input).flatMap((section) => section.operations);

const find = (input: ContentOperationsInput, key: ContentOperationKey) => {
  const operation = flatten(input).find((candidate) => candidate.key === key);
  if (!operation) throw new Error(`operation ${key} was not offered at all`);
  return operation;
};

describe("buildContentOperations — availability is never silent", () => {
  it("1. groups operations rather than returning one flat list", () => {
    expect(buildContentOperations(BASE).map((section) => section.key)).toEqual(["IMPROVE", "REPURPOSE", "TECHNICAL"]);
  });

  it("2. every operation either has an href or a reason — never both, never neither", () => {
    for (const stage of ["HAS_ARTICLE", "BRIEF_ONLY", "MANUAL"] as const) {
      for (const body of [BASE.body, null, "   "]) {
        for (const operation of flatten({ ...BASE, workflowStage: stage, body })) {
          expect(operation.href === null).toBe(operation.unavailableReason !== null);
          if (operation.unavailableReason !== null) expect(operation.unavailableReason.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("3. offers no duplicate operation keys", () => {
    const keys = flatten(BASE).map((operation) => operation.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("4. a fully live, article-bearing record gets every operation except long-form", () => {
    const unavailable = flatten(BASE).filter((operation) => operation.href === null);
    expect(unavailable.map((operation) => operation.key)).toEqual(["LONG_FORM"]);
  });

  it("5. carries only ids in a hand-off href — never a title, url, status or company", () => {
    for (const operation of flatten(BASE)) {
      if (operation.href === null) continue;
      const query = operation.href.split("?")[1] ?? "";
      for (const [key, value] of new URLSearchParams(query)) {
        expect(["seoProjectId", "contentId"]).toContain(key);
        expect([BASE.seoProjectId, BASE.contentId]).toContain(value);
      }
    }
  });

  it("6. points every hand-off at an existing tool route, never a new one", () => {
    const hrefs = flatten(BASE)
      .map((operation) => operation.href)
      .filter((href): href is string => href !== null);
    expect(hrefs.every((href) => href.startsWith("/ai/"))).toBe(true);
  });
});

describe("body-dependent operations", () => {
  it("7. Rewrite and Internal links both require an article body", () => {
    for (const body of [null, "", "   "]) {
      for (const key of ["REWRITE", "INTERNAL_LINKS"] as const) {
        const operation = find({ ...BASE, body, workflowStage: "MANUAL" }, key);
        expect(operation.href).toBeNull();
        expect(operation.unavailableReason).toContain("no article body");
      }
    }
  });

  it("8. Schema, Social snippets and Newsletter stay available without a body", () => {
    for (const key of ["SCHEMA", "SOCIAL_SNIPPETS", "NEWSLETTER"] as const) {
      expect(find({ ...BASE, body: null, workflowStage: "BRIEF_ONLY" }, key).href).not.toBeNull();
    }
  });

  it("9. Meta tags stay available without a body — every row has a title", () => {
    expect(find({ ...BASE, body: null, workflowStage: "MANUAL" }, "META_TAGS").href).not.toBeNull();
  });
});

describe("long-form", () => {
  it("10. is offered only for a brief-only record, and targets the existing brief route", () => {
    const operation = find({ ...BASE, body: null, workflowStage: "BRIEF_ONLY" }, "LONG_FORM");
    expect(operation.href).toBe("/ai/content-brief/content-1/long-form");
  });

  it("11. explains that an article already exists rather than vanishing", () => {
    const operation = find(BASE, "LONG_FORM");
    expect(operation.href).toBeNull();
    expect(operation.unavailableReason).toContain("already has an article");
  });

  it("12. explains the missing brief for a manually-created record", () => {
    const operation = find({ ...BASE, body: null, workflowStage: "MANUAL" }, "LONG_FORM");
    expect(operation.unavailableReason).toContain("content brief");
  });
});

describe("the panel as a whole", () => {
  it("13. offers nothing without manage permission, and says why", () => {
    const input = { ...BASE, canManage: false };
    expect(buildContentOperations(input)).toEqual([]);
    expect(describeOperationsUnavailable(input)).toContain("manage SEO projects");
  });

  it("14. offers nothing for a trashed record, naming the record", () => {
    const input = { ...BASE, contentDeletedAt: new Date("2026-01-01T00:00:00Z") };
    expect(buildContentOperations(input)).toEqual([]);
    expect(describeOperationsUnavailable(input)).toContain("in the trash");
    expect(describeOperationsUnavailable(input)).toContain("Restore it");
  });

  it("15. offers nothing under a trashed project, naming the project", () => {
    // A live Content row under a soft-deleted project genuinely exists in this
    // database — the tools' own project lists exclude it, so offering the
    // action would dead-end.
    const input = { ...BASE, projectDeletedAt: new Date("2026-01-01T00:00:00Z") };
    expect(buildContentOperations(input)).toEqual([]);
    expect(describeOperationsUnavailable(input)).toContain("SEO project");
  });

  it("16. a permission failure is reported as permission, not as a trashed record", () => {
    const reason = describeOperationsUnavailable({ ...BASE, canManage: false });
    expect(reason).not.toContain("trash");
  });

  it("17. reports no reason at all when operations are available", () => {
    expect(describeOperationsUnavailable(BASE)).toBeNull();
  });

  it("18. declines to build anything from a blank id", () => {
    expect(buildContentOperations({ ...BASE, contentId: "" })).toEqual([]);
    expect(buildContentOperations({ ...BASE, seoProjectId: "  " })).toEqual([]);
  });
});

describe("honesty of the copy", () => {
  it("19. mentions publishing, sending or scheduling only to DENY it", () => {
    /*
     * A blanket ban on the words is the wrong test: the honest copy has to be
     * able to say "nothing is posted, scheduled or sent". What must never
     * appear is an AFFIRMATIVE claim, so every sentence mentioning one of
     * these verbs is required to carry a negation.
     */
    const sentences = buildContentOperations(BASE)
      .flatMap((section) => [section.description, ...section.operations.map((operation) => operation.description)])
      .flatMap((text) => text.split(/(?<=[.;])\s+/));

    const mentions = sentences.filter((sentence) => /\b(posts?|posted|schedul\w*|sends?|sent|publish\w*)\b/i.test(sentence));
    expect(mentions.length).toBeGreaterThan(0);
    for (const sentence of mentions) {
      expect(sentence).toMatch(/\b(nothing|none|never|no)\b/i);
    }
  });

  it("20. states plainly that the repurpose tools publish nothing", () => {
    const section = buildContentOperations(BASE).find((candidate) => candidate.key === "REPURPOSE");
    expect(section?.description).toMatch(/none of them publishes, sends or schedules/i);
    for (const operation of section?.operations ?? []) {
      expect(operation.description).toMatch(/nothing is (posted|sent)/i);
    }
  });

  it("21. the not-yet-available list names each gap with a reason and no link", () => {
    expect(UNAVAILABLE_OPERATIONS.length).toBeGreaterThan(0);
    for (const entry of UNAVAILABLE_OPERATIONS) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry).not.toHaveProperty("href");
    }
  });

  it("22. names the real Social Composer rather than claiming no social integration exists", () => {
    const social = UNAVAILABLE_OPERATIONS.find((entry) => entry.label.includes("social"));
    expect(social?.reason).toContain("Social Composer");
    expect(social?.reason).not.toMatch(/WordPress|no social platform integration/i);
  });
});

describe("describeContentIdentity", () => {
  it("23. reports an unassigned client as unassigned rather than guessing one", () => {
    const identity = describeContentIdentity({
      clientId: null,
      clientName: null,
      seoProjectName: "Storage Moguls",
      body: null,
      workflowStage: "MANUAL",
    });
    expect(identity.clientId).toBeNull();
    expect(identity.clientName).toBeNull();
    expect(identity.seoProjectName).toBe("Storage Moguls");
  });

  it("24. passes a real client through untouched", () => {
    const identity = describeContentIdentity({
      clientId: "client-1",
      clientName: "Acme Plumbing",
      seoProjectName: "Storage Moguls",
      body: "x",
      workflowStage: "HAS_ARTICLE",
    });
    expect(identity.clientName).toBe("Acme Plumbing");
    expect(identity.clientId).toBe("client-1");
  });

  it("25. treats a whitespace-only body as no article", () => {
    for (const body of [null, "", "   \n  "]) {
      const identity = describeContentIdentity({ clientId: null, clientName: null, seoProjectName: "p", body, workflowStage: "MANUAL" });
      expect(identity.hasArticle).toBe(false);
    }
    expect(describeContentIdentity({ clientId: null, clientName: null, seoProjectName: "p", body: "words", workflowStage: "HAS_ARTICLE" }).hasArticle).toBe(true);
  });

  it("26. gives every workflow stage a label and a detail sentence", () => {
    for (const stage of ["BRIEF_ONLY", "HAS_ARTICLE", "MANUAL"] as const) {
      const identity = describeContentIdentity({ clientId: null, clientName: null, seoProjectName: "p", body: null, workflowStage: stage });
      expect(identity.stageLabel.length).toBeGreaterThan(0);
      expect(identity.stageDetail.length).toBeGreaterThan(0);
    }
  });

  it("27. never describes a stage as scheduled", () => {
    for (const stage of ["BRIEF_ONLY", "HAS_ARTICLE", "MANUAL"] as const) {
      const identity = describeContentIdentity({ clientId: null, clientName: null, seoProjectName: "p", body: null, workflowStage: stage });
      expect(`${identity.stageLabel} ${identity.stageDetail}`).not.toMatch(/\bschedul/i);
    }
  });
});

describe("workspaceSelectionForContent — the return leg keeps the context it came from", () => {
  it("28. a record under a client returns to that client and project", () => {
    expect(workspaceSelectionForContent("client-1", "project-a")).toEqual({ clientId: "client-1", projectId: "project-a" });
  });

  it("29. a record whose project has NO client returns to 'no client assigned', NOT to all clients", () => {
    // Browser verification caught this: falling back to "all" silently widened
    // the view beyond the one the user came from.
    expect(workspaceSelectionForContent(null, "project-a")).toEqual({ clientId: "unassigned", projectId: "project-a" });
  });

  it("30. falls back to all clients only when there is nothing more specific to say", () => {
    expect(workspaceSelectionForContent(null, "")).toEqual({ clientId: "all", projectId: "" });
  });
});
