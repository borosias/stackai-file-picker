import { describe, expect, it } from "vitest"

import {
  buildCapabilities,
  normalizeResolvedSourceSet,
  recomputeIndexedSourceSet,
  resolveSourceMembership,
} from "@/server/file-picker/domain"

describe("file-picker domain", () => {
  it("collapses descendants when an ancestor folder source exists", () => {
    const normalized = normalizeResolvedSourceSet([
      { id: "folder-a", path: "/docs", type: "folder" },
      { id: "file-a", path: "/docs/a.txt", type: "file" },
      { id: "folder-b", path: "/docs/contracts", type: "folder" },
    ])

    expect(normalized).toEqual([{ id: "folder-a", path: "/docs", type: "folder" }])
  })

  it("detects inherited membership from indexed parent folders", () => {
    const membership = resolveSourceMembership(
      [{ id: "folder-a", path: "/docs", type: "folder" }],
      {
        id: "file-a",
        resourcePath: "/docs/a.txt",
      },
    )

    expect(membership).toBe("inherited")
  })

  it("keeps source set unchanged when indexing a child already covered by an ancestor", () => {
    const result = recomputeIndexedSourceSet(
      [{ id: "folder-a", path: "/docs", type: "folder" }],
      { id: "file-a", path: "/docs/a.txt", type: "file" },
    )

    expect(result.reasonCode).toBe("already_covered_by_ancestor")
    expect(result.nextSources).toEqual([{ id: "folder-a", path: "/docs", type: "folder" }])
  })

  it("allows unlist for direct items even when the materialized status is still unknown", () => {
    const capabilities = buildCapabilities({
      binding: {
        state: "ready",
        knowledgeBaseId: "kb-1",
      },
      itemType: "file",
      sourceMembership: "direct",
      indexState: "unknown",
      presentInKb: true,
      isHidden: false,
    })

    expect(capabilities.unlist).toEqual({
      allowed: true,
    })
  })
})
