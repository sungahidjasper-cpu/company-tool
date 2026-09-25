import { describe, expect, it } from "vitest";

import { contentDetailHref, contentRevalidatePaths } from "@/features/content-workspace/services/content-location";

/**
 * Content is reachable at two addresses now: the long-standing project-scoped
 * one, and a client-first one for records that have no project to name. The
 * whole point of this module is that no call site has to decide which.
 */
describe("where a content record lives", () => {
  it("1. project content keeps its EXISTING SEO address, unchanged", () => {
    expect(contentDetailHref({ id: "content-1", seoProjectId: "project-1" })).toBe("/seo/project-1/content/content-1");
  });

  it("2. client-owned content gets the project-free address", () => {
    expect(contentDetailHref({ id: "content-1", seoProjectId: null })).toBe("/content/content-1");
  });

  it("3. BACKWARD COMPATIBILITY: every record that has a project still resolves to the old URL", () => {
    for (const projectId of ["p1", "01a002a5-ffa5-705e-9731-806267514305"]) {
      expect(contentDetailHref({ id: "c", seoProjectId: projectId })).toBe(`/seo/${projectId}/content/c`);
    }
  });
});

describe("what to revalidate when a record changes", () => {
  it("4. project content still revalidates its project listing and detail page", () => {
    const paths = contentRevalidatePaths({ id: "content-1", seoProjectId: "project-1" });
    expect(paths).toContain("/seo/project-1/content");
    expect(paths).toContain("/seo/project-1/content/content-1");
    expect(paths).toContain("/seo/project-1");
  });

  it("5. every record revalidates the client-first workspace and its own address", () => {
    for (const seoProjectId of ["project-1", null]) {
      const paths = contentRevalidatePaths({ id: "content-1", seoProjectId });
      expect(paths).toContain("/content");
      expect(paths).toContain("/content/content-1");
    }
  });

  it("6. client-owned content never invents a project path", () => {
    const paths = contentRevalidatePaths({ id: "content-1", seoProjectId: null });
    expect(paths.some((path) => path.startsWith("/seo/"))).toBe(false);
  });

  it("7. no path is ever duplicated", () => {
    const paths = contentRevalidatePaths({ id: "content-1", seoProjectId: "project-1" });
    expect(new Set(paths).size).toBe(paths.length);
  });
});
