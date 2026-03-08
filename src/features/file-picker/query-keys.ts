const FILES_KEY = ["files"] as const

interface FolderChildrenKeyArgs {
  parentId: string
  parentPath?: string
  query?: string
  pageSize?: number
  includeHidden?: boolean
}

interface StatusOverlayKeyArgs {
  mode: "browse" | "search"
  parentPath?: string
  query?: string
  itemIds: readonly string[]
}

export function filesKey(): readonly ["files"] {
  return FILES_KEY
}

export function folderChildrenKey({
  parentId,
  parentPath,
  query,
  pageSize,
  includeHidden,
}: FolderChildrenKeyArgs) {
  const normalizedQuery = query?.trim()
  const normalizedPageSize = String(pageSize ?? 100)
  const hiddenSegment = includeHidden ? "with-hidden" : "visible-only"

  if (normalizedQuery) {
    return [
      ...FILES_KEY,
      "search",
      normalizedQuery,
      normalizedPageSize,
      hiddenSegment,
    ] as const
  }

  return [
    ...FILES_KEY,
    "folder",
    parentId,
    parentPath ?? "/",
    normalizedPageSize,
    hiddenSegment,
  ] as const
}

export function folderStatusKey({
  mode,
  parentPath,
  query,
  itemIds,
}: StatusOverlayKeyArgs) {
  return [
    ...FILES_KEY,
    "status",
    mode,
    parentPath ?? "/",
    query?.trim() ?? "",
    [...itemIds].sort().join(","),
  ] as const
}
