import { describe, expect, it } from "vitest"

import type { DriveItem } from "@/lib/drive-types"
import { filterAndSortItems, formatDateLabel } from "@/features/file-picker/utils"

const ITEMS: DriveItem[] = [
  {
    id: "folder-b",
    name: "Beta folder",
    type: "folder",
    parentId: "root",
    modifiedAt: "2026-01-02T00:00:00.000Z",
    indexState: "indexed",
    indexOrigin: "direct",
  },
  {
    id: "file-z",
    name: "zeta notes.md",
    type: "file",
    parentId: "root",
    modifiedAt: "2026-01-03T00:00:00.000Z",
    indexState: "not_indexed",
    indexOrigin: "none",
  },
  {
    id: "file-a",
    name: "Alpha summary.md",
    type: "file",
    parentId: "root",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    indexState: "not_indexed",
    indexOrigin: "none",
  },
]

describe("filterAndSortItems", () => {
  it("filters by text query case-insensitively", () => {
    const result = filterAndSortItems(ITEMS, {
      query: "alpha",
      typeFilter: "all",
      sortBy: "name",
      sortDirection: "asc",
    })

    expect(result.map((item) => item.id)).toEqual(["file-a"])
  })

  it("filters by item type", () => {
    const result = filterAndSortItems(ITEMS, {
      query: "",
      typeFilter: "folder",
      sortBy: "name",
      sortDirection: "asc",
    })

    expect(result.map((item) => item.id)).toEqual(["folder-b"])
  })

  it("sorts by name in descending order", () => {
    const result = filterAndSortItems(ITEMS, {
      query: "",
      typeFilter: "all",
      sortBy: "name",
      sortDirection: "desc",
    })

    expect(result.map((item) => item.id)).toEqual(["file-z", "folder-b", "file-a"])
  })

  it("sorts by date in ascending order", () => {
    const result = filterAndSortItems(ITEMS, {
      query: "",
      typeFilter: "all",
      sortBy: "date",
      sortDirection: "asc",
    })

    expect(result.map((item) => item.id)).toEqual(["file-a", "folder-b", "file-z"])
  })

  it("formats dates with a deterministic locale and timezone", () => {
    expect(formatDateLabel("2025-08-27T00:17:00.000Z")).toBe("Aug 27, 2025 at 12:17 AM")
  })
})
