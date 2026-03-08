import type {
  ActionCapability,
  CapabilityReasonCode,
  DisplayStatus,
  DriveItem,
  DriveItemCapabilities,
  DriveItemType,
  IndexOrigin,
  IndexState,
  KnowledgeBaseBinding,
} from "@/lib/drive-types"

export interface ResourceDescriptor {
  id: string
  name: string
  type: DriveItemType
  parentId: string
  resourcePath: string
  modifiedAt: string
  sizeBytes: number | null
  mimeType: string | null
}

export interface SourceDescriptor {
  id: string
  path: string
  type: DriveItemType
}

export type SourceMembership = IndexOrigin

export function normalizePath(path: string | undefined): string {
  const trimmed = path?.trim()
  if (!trimmed) {
    return "/"
  }

  let normalized = trimmed.replace(/\\/g, "/")
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`
  }

  normalized = normalized.replace(/\/{2,}/g, "/")

  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1)
  }

  return normalized || "/"
}

export function getParentPath(resourcePath: string): string {
  const normalized = normalizePath(resourcePath)
  if (normalized === "/") {
    return "/"
  }

  const lastSlash = normalized.lastIndexOf("/")
  if (lastSlash <= 0) {
    return "/"
  }

  return normalized.slice(0, lastSlash) || "/"
}

export function isSameOrDescendantPath(targetPath: string, candidatePath: string): boolean {
  const normalizedTarget = normalizePath(targetPath)
  const normalizedCandidate = normalizePath(candidatePath)

  if (normalizedTarget === "/") {
    return true
  }

  return (
    normalizedCandidate === normalizedTarget ||
    normalizedCandidate.startsWith(`${normalizedTarget}/`)
  )
}

export function coerceIsoDate(value: unknown): string {
  const fallbackIso = "1970-01-01T00:00:00.000Z"
  if (typeof value !== "string" || !value.trim()) {
    return fallbackIso
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    return fallbackIso
  }

  return parsed.toISOString()
}

export function normalizeIndexStateFromStatus(status: unknown): IndexState {
  if (typeof status !== "string" || !status.trim()) {
    return "unknown"
  }

  const normalized = status.trim().toLowerCase()
  if (normalized === "indexed") {
    return "indexed"
  }
  if (normalized === "resource" || normalized === "parsed" || normalized === "pending") {
    return "pending"
  }
  if (normalized === "pending_delete") {
    return "deindexing"
  }
  if (normalized === "deleted") {
    return "not_indexed"
  }
  if (normalized === "error" || normalized.includes("fail")) {
    return "error"
  }

  return "unknown"
}

export function toDriveItem(resource: ResourceDescriptor, isHidden = false): DriveItem {
  return {
    id: resource.id,
    name: resource.name,
    type: resource.type,
    parentId: resource.parentId,
    resourcePath: resource.resourcePath,
    modifiedAt: resource.modifiedAt,
    sizeBytes: resource.sizeBytes,
    mimeType: resource.mimeType,
    indexState: "unknown",
    indexOrigin: "unknown",
    isHidden,
  }
}

export function toSourceDescriptor(resource: Pick<ResourceDescriptor, "id" | "resourcePath" | "type">): SourceDescriptor {
  return {
    id: resource.id,
    path: normalizePath(resource.resourcePath),
    type: resource.type,
  }
}

export function normalizeResolvedSourceSet(sources: readonly SourceDescriptor[]): SourceDescriptor[] {
  const uniqueById = new Map<string, SourceDescriptor>()
  for (const source of sources) {
    if (!uniqueById.has(source.id)) {
      uniqueById.set(source.id, {
        ...source,
        path: normalizePath(source.path),
      })
    }
  }

  const sorted = [...uniqueById.values()].sort((left, right) => {
    const depthCompare = left.path.length - right.path.length
    if (depthCompare !== 0) {
      return depthCompare
    }

    if (left.path !== right.path) {
      return left.path.localeCompare(right.path)
    }

    if (left.type === right.type) {
      return left.id.localeCompare(right.id)
    }

    return left.type === "folder" ? -1 : 1
  })

  const normalized: SourceDescriptor[] = []

  for (const candidate of sorted) {
    const coveredByAncestor = normalized.some(
      (current) =>
        current.path === candidate.path ||
        (current.type === "folder" && isSameOrDescendantPath(current.path, candidate.path)),
    )

    if (!coveredByAncestor) {
      normalized.push(candidate)
    }
  }

  return normalized
}

export function recomputeIndexedSourceSet(
  currentSources: readonly SourceDescriptor[],
  nextSource: SourceDescriptor,
): {
  nextSources: SourceDescriptor[]
  reasonCode?: Extract<
    CapabilityReasonCode,
    "already_indexed_direct" | "already_covered_by_ancestor"
  >
} {
  const normalizedCurrent = normalizeResolvedSourceSet(currentSources)
  if (normalizedCurrent.some((source) => source.id === nextSource.id)) {
    return {
      nextSources: normalizedCurrent,
      reasonCode: "already_indexed_direct",
    }
  }

  const coveredByAncestor = normalizedCurrent.some(
    (source) =>
      source.type === "folder" && isSameOrDescendantPath(source.path, nextSource.path),
  )

  if (coveredByAncestor) {
    return {
      nextSources: normalizedCurrent,
      reasonCode: "already_covered_by_ancestor",
    }
  }

  return {
    nextSources: normalizeResolvedSourceSet([...normalizedCurrent, nextSource]),
  }
}

export function recomputeDeindexedSourceSet(
  currentSources: readonly SourceDescriptor[],
  sourceIdToRemove: string,
): SourceDescriptor[] {
  return normalizeResolvedSourceSet(
    currentSources.filter((source) => source.id !== sourceIdToRemove),
  )
}

export function resolveSourceMembership(
  currentSources: readonly SourceDescriptor[],
  item: Pick<ResourceDescriptor, "id" | "resourcePath">,
): SourceMembership {
  const itemPath = normalizePath(item.resourcePath)
  if (!itemPath) {
    return "unknown"
  }

  const normalizedSources = normalizeResolvedSourceSet(currentSources)
  if (normalizedSources.some((source) => source.id === item.id)) {
    return "direct"
  }

  const inherited = normalizedSources.some(
    (source) =>
      source.type === "folder" && isSameOrDescendantPath(source.path, itemPath),
  )

  return inherited ? "inherited" : "none"
}

function allow(): ActionCapability {
  return {
    allowed: true,
  }
}

function deny(
  reasonCode: CapabilityReasonCode,
  reasonMessage: string,
): ActionCapability {
  return {
    allowed: false,
    reasonCode,
    reasonMessage,
  }
}

function describeBindingFailure(binding: KnowledgeBaseBinding): ActionCapability {
  if (binding.state === "ready") {
    return allow()
  }

  return deny(
    binding.state,
    binding.message ?? "Knowledge base configuration is not ready for actions.",
  )
}

export function buildCapabilities(args: {
  binding: KnowledgeBaseBinding
  itemType: DriveItemType
  sourceMembership: SourceMembership
  indexState: IndexState
  presentInKb: boolean
  isHidden: boolean
  isFullyIndexed?: boolean
}): DriveItemCapabilities {
  const restore = args.isHidden
    ? allow()
    : deny("not_hidden", "This item is not hidden.")

  if (args.isHidden) {
    return {
      index: deny("hidden_item", "Hidden items must be restored before indexing."),
      deindex: deny("hidden_item", "Hidden items must be restored before de-indexing."),
      unlist: deny("hidden_item", "This item is already hidden."),
      restore,
    }
  }

  if (args.binding.state !== "ready") {
    const blocked = describeBindingFailure(args.binding)
    return {
      index: blocked,
      deindex: blocked,
      unlist:
        args.itemType === "file"
          ? allow()
          : deny("unsupported_item_type", "Only files can be removed from listing."),
      restore,
    }
  }

  const isDirectSource = args.sourceMembership === "direct"
  const isFullyIndexed = args.isFullyIndexed ?? false

  const index =
    args.itemType === "folder"
      ? isDirectSource
        ? deny(
            "already_indexed_direct",
            "This folder is already indexed directly.",
          )
        : isFullyIndexed
        ? deny(
            args.sourceMembership === "inherited"
                ? "already_covered_by_ancestor"
                : "already_in_kb",
            args.sourceMembership === "inherited"
                ? "This folder is already fully covered by an indexed parent."
                : "This folder is already present in the knowledge base.",
          )
        : allow()
      : isDirectSource
        ? deny(
            "already_indexed_direct",
            "This item is already indexed directly.",
          )
        : args.presentInKb
        ? deny(
            args.sourceMembership === "inherited"
              ? "already_covered_by_ancestor"
              : "already_in_kb",
            args.sourceMembership === "inherited"
              ? "This item is already present in the knowledge base through an indexed parent."
              : "This item is already present in the knowledge base.",
          )
        : allow()

  const deindex =
    args.presentInKb || isDirectSource
      ? allow()
      : deny("not_indexed", "This item is not in the knowledge base.")

  const unlist =
    args.itemType === "file"
      ? allow()
      : deny("unsupported_item_type", "Only files can be removed from listing.")

  return {
    index,
    deindex,
    unlist,
    restore,
  }
}

function statusUnavailable(kind: DisplayStatus["kind"], tooltip?: string): DisplayStatus {
  return {
    code: "status_unavailable",
    label: "Status unavailable",
    tone: "neutral",
    kind,
    ...(tooltip ? { tooltip } : {}),
  }
}

export function buildDisplayStatus(args: {
  binding: KnowledgeBaseBinding
  itemType: DriveItemType
  indexState: IndexState
  presentInKb?: boolean
  isFullyIndexed?: boolean
  folderDisplayVariant?: "full" | "partial" | "present"
}): DisplayStatus {
  if (args.binding.state !== "ready") {
    return statusUnavailable("binding", args.binding.message)
  }

  if (args.indexState === "error") {
    return {
      code: "error",
      label: "Error",
      tone: "danger",
      kind: "materialization",
    }
  }

  if (args.indexState === "deindexing") {
    return {
      code: "removing",
      label: "Removing from KB",
      tone: "warning",
      kind: "materialization",
    }
  }

  if (args.indexState === "pending") {
    return {
      code: "syncing",
      label: "Syncing",
      tone: "warning",
      kind: "materialization",
    }
  }

  if (args.presentInKb) {
    if (args.itemType === "folder") {
      if (args.folderDisplayVariant === "full" || args.isFullyIndexed) {
        return {
          code: "in_kb",
          label: "Fully indexed",
          tone: "success",
          kind: "source-membership",
          tooltip:
            "This folder is fully covered by the current knowledge base state.",
        }
      }

      if (args.folderDisplayVariant === "partial") {
        return {
          code: "partially_in_kb",
          label: "Partially in KB",
          tone: "info",
          kind: "tree-presence",
          tooltip:
            "This folder appears in the knowledge base, but its full subtree is not confirmed as directly indexed.",
        }
      }

      return {
        code: "in_kb",
        label: "In KB",
        tone: "info",
        kind: "tree-presence",
        tooltip: "This folder is currently present in the knowledge base.",
      }
    }

    const tooltip =
      "This item is currently present in the knowledge base."

    return {
      code: "in_kb",
      label: "In KB",
      tone: "success",
      kind: "materialization",
      ...(tooltip ? { tooltip } : {}),
    }
  }

  if (args.indexState === "not_indexed") {
    return {
      code: "not_in_kb",
      label: "Not in KB",
      tone: "neutral",
      kind: "materialization",
    }
  }

  if (args.indexState === "unknown") {
    return statusUnavailable("materialization")
  }

  return {
    code: "not_in_kb",
    label: "Not in KB",
    tone: "neutral",
    kind: "materialization",
  }
}
