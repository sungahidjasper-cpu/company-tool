import { describe, expect, it } from "vitest";

import { getUnlinkedKnowledgeSources } from "@/features/seo/lib/knowledge-source-availability";

function makeSource(id: string) {
  return { id, title: `Source ${id}` };
}

describe("getUnlinkedKnowledgeSources", () => {
  it("1. returns every source when nothing is linked yet", () => {
    const sources = [makeSource("a"), makeSource("b")];
    expect(getUnlinkedKnowledgeSources(sources, [])).toEqual(sources);
  });

  it("2. excludes a source that is already linked", () => {
    const sources = [makeSource("a"), makeSource("b")];
    const result = getUnlinkedKnowledgeSources(sources, [{ knowledgeSourceId: "a" }]);
    expect(result).toEqual([makeSource("b")]);
  });

  it("3. excludes every source once all are linked", () => {
    const sources = [makeSource("a"), makeSource("b")];
    const links = [{ knowledgeSourceId: "a" }, { knowledgeSourceId: "b" }];
    expect(getUnlinkedKnowledgeSources(sources, links)).toEqual([]);
  });

  it("4. ignores a link pointing at a source not in the supplied company list (e.g. a different company's stale id)", () => {
    const sources = [makeSource("a")];
    const result = getUnlinkedKnowledgeSources(sources, [{ knowledgeSourceId: "unrelated-id" }]);
    expect(result).toEqual([makeSource("a")]);
  });

  it("5. preserves the original source order", () => {
    const sources = [makeSource("c"), makeSource("a"), makeSource("b")];
    const result = getUnlinkedKnowledgeSources(sources, [{ knowledgeSourceId: "a" }]);
    expect(result.map((s) => s.id)).toEqual(["c", "b"]);
  });

  it("6. is unaffected by a source being linked more than once (duplicate links)", () => {
    const sources = [makeSource("a"), makeSource("b")];
    const links = [{ knowledgeSourceId: "a" }, { knowledgeSourceId: "a" }];
    expect(getUnlinkedKnowledgeSources(sources, links)).toEqual([makeSource("b")]);
  });
});
