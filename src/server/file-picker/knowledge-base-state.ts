import type {
  FolderItemsResponse,
  StatusOverlayRequest,
} from "@/lib/drive-types"
import {
  getParentPath,
  normalizeIndexStateFromStatus,
  normalizeResolvedSourceSet,
  resolveSourceMembership,
  toSourceDescriptor,
  type ResourceDescriptor,
} from "@/server/file-picker/domain"
import {
  FilePickerServerError,
  toHttpError,
} from "@/server/file-picker/errors"
import {
  readCachedKnowledgeBaseDetails,
  readCachedResolvedFolderSources,
  writeCachedKnowledgeBaseDetails,
  writeCachedResolvedFolderSources,
} from "@/server/file-picker/cache"
import {
  getConnectionResourcesByIds,
} from "@/server/file-picker/adapters/stack-ai/connections-gateway"
import {
  getKnowledgeBaseDetails,
  listKnowledgeBaseChildren,
  searchKnowledgeBaseResources,
  type KnowledgeBaseDetails,
  type KnowledgeBaseStatusResource,
} from "@/server/file-picker/adapters/stack-ai/knowledge-bases-gateway"
import type {
  FilePickerDependencies,
  KnowledgeBaseSourceState,
  ResolvedBinding,
  StatusSnapshot,
  StatusMode,
} from "@/server/file-picker/runtime-types"

function uniqueSourceIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => id.trim()))]
}

export async function resolveKnowledgeBaseBinding(
  deps: FilePickerDependencies,
): Promise<ResolvedBinding> {
  if (!deps.config.knowledgeBaseId) {
    return {
      public: {
        state: "missing_config",
        message: "Set STACKAI_KNOWLEDGE_BASE_ID to enable indexing actions and KB statuses.",
      },
    }
  }

  try {
    const cachedDetails = readCachedKnowledgeBaseDetails(deps.config.knowledgeBaseId)
    const details =
      cachedDetails ??
      writeCachedKnowledgeBaseDetails(
        deps.config.knowledgeBaseId,
        await getKnowledgeBaseDetails(deps.config),
      )

    if (details.connectionId !== deps.config.connectionId) {
      return {
        public: {
          state: "connection_mismatch",
          knowledgeBaseId: details.knowledgeBaseId,
          message:
            "The configured knowledge base belongs to a different connection.",
        },
      }
    }

    return {
      public: {
        state: "ready",
        knowledgeBaseId: details.knowledgeBaseId,
      },
      details,
    }
  } catch (error) {
    const httpError = toHttpError(error)
    if (httpError.status === 404) {
      return {
        public: {
          state: "not_found",
          knowledgeBaseId: deps.config.knowledgeBaseId,
          message: "The configured knowledge base was not found in Stack AI.",
        },
      }
    }

    throw error
  }
}

export function requireReadyBinding(binding: ResolvedBinding): KnowledgeBaseDetails {
  if (!binding.details) {
    throw new FilePickerServerError(
      binding.public.message ?? "Knowledge base binding is not ready.",
      {
        status:
          binding.public.state === "missing_config"
            ? 412
            : binding.public.state === "connection_mismatch"
              ? 409
              : 404,
        code: binding.public.state,
      },
    )
  }

  return binding.details
}

export function buildStatusLookup(resources: readonly KnowledgeBaseStatusResource[]): {
  byId: Map<string, KnowledgeBaseStatusResource>
  byPath: Map<string, KnowledgeBaseStatusResource>
} {
  return {
    byId: new Map(resources.map((resource) => [resource.id, resource])),
    byPath: new Map(resources.map((resource) => [resource.resourcePath, resource])),
  }
}

export function resolveMaterializedResource(
  lookup: ReturnType<typeof buildStatusLookup>,
  item: Pick<ResourceDescriptor, "id" | "resourcePath">,
): KnowledgeBaseStatusResource | undefined {
  return lookup.byId.get(item.id) ?? lookup.byPath.get(item.resourcePath)
}

function isKnowledgeBasePathNotFoundError(error: unknown): boolean {
  const httpError = toHttpError(error)
  return (
    /could not resolve path/i.test(httpError.message) ||
    /path error/i.test(httpError.message) ||
    /does not exist/i.test(httpError.message)
  )
}

export async function listKnowledgeBaseChildrenForOverlay(
  deps: FilePickerDependencies,
  parentPath: string,
): Promise<KnowledgeBaseStatusResource[]> {
  try {
    return await listKnowledgeBaseChildren(deps.config, parentPath)
  } catch (error) {
    // After StackAI removes a subtree, follow-up reads for that same path often
    // fail with a path error instead of returning an empty list. For status
    // overlay reads we treat that as "the subtree is gone".
    if (isKnowledgeBasePathNotFoundError(error)) {
      return []
    }

    throw error
  }
}

export async function resolveKnowledgeBaseSourceState(
  deps: FilePickerDependencies,
  details: KnowledgeBaseDetails,
  options?: {
    includeResolvedFolders?: boolean
  },
): Promise<KnowledgeBaseSourceState> {
  const sourceIds = uniqueSourceIds(details.connectionSourceIds)
  if (!options?.includeResolvedFolders || sourceIds.length === 0) {
    return {
      rawSourceIds: new Set(sourceIds),
      resolvedFolderSources: [],
    }
  }

  const cachedResolvedFolderSources = readCachedResolvedFolderSources({
    knowledgeBaseId: details.knowledgeBaseId,
    sourceIds,
  })

  if (cachedResolvedFolderSources) {
    return {
      rawSourceIds: new Set(sourceIds),
      resolvedFolderSources: cachedResolvedFolderSources,
    }
  }

  const resolved = await getConnectionResourcesByIds(deps.config, sourceIds)
  const resolvedFolderSources = normalizeResolvedSourceSet(
    sourceIds
      .map((sourceId) => resolved.get(sourceId))
      .filter((resource): resource is ResourceDescriptor => Boolean(resource))
      .filter((resource) => resource.type === "folder")
      .map((resource) => toSourceDescriptor(resource)),
  )

  writeCachedResolvedFolderSources({
    knowledgeBaseId: details.knowledgeBaseId,
    sourceIds,
    sources: resolvedFolderSources,
  })

  return {
    rawSourceIds: new Set(sourceIds),
    resolvedFolderSources,
  }
}

export function resolveSourceMembershipFromKnowledgeBaseState(
  sourceState: KnowledgeBaseSourceState,
  item: Pick<ResourceDescriptor, "id" | "resourcePath">,
): FolderItemsResponse["items"][number]["indexOrigin"] {
  if (sourceState.rawSourceIds.has(item.id)) {
    return "direct"
  }

  return resolveSourceMembership(sourceState.resolvedFolderSources, item)
}

export function isPresentInKnowledgeBaseTree(
  resources: readonly KnowledgeBaseStatusResource[],
  item: Pick<ResourceDescriptor, "resourcePath" | "type">,
): boolean {
  if (item.type !== "folder") {
    return false
  }

  return resources.some(
    (resource) =>
      resource.type === "folder" && resource.resourcePath === item.resourcePath,
  )
}

export function resolveStatusSnapshot(args: {
  item: Pick<ResourceDescriptor, "id" | "resourcePath" | "type">
  materializedResource: KnowledgeBaseStatusResource | undefined
  presentInKbTree: boolean
  sourceState: KnowledgeBaseSourceState
  mode: StatusMode
}): StatusSnapshot {
  const normalizedMaterializedState = args.materializedResource
    ? normalizeIndexStateFromStatus(args.materializedResource.status)
    : undefined
  // Source membership is only a helper for folder coverage. User-visible truth
  // still comes from actual KB presence in tree/search reads.
  const sourceMembership = resolveSourceMembershipFromKnowledgeBaseState(
    args.sourceState,
    args.item,
  )
  const isFullyIndexed =
    args.item.type === "folder" &&
    (sourceMembership === "direct" || sourceMembership === "inherited")
  const presentInKb =
    args.item.type === "folder"
      ? args.mode === "browse"
        ? Boolean(args.materializedResource) || args.presentInKbTree
        : isFullyIndexed || Boolean(args.materializedResource)
      : Boolean(args.materializedResource)

  if (
    normalizedMaterializedState &&
    normalizedMaterializedState !== "unknown" &&
    normalizedMaterializedState !== "not_indexed"
  ) {
    return {
      presentInKb,
      indexState: normalizedMaterializedState,
      sourceMembership,
      isFullyIndexed,
    }
  }

  if (presentInKb) {
    return {
      presentInKb,
      indexState: "indexed",
      sourceMembership,
      isFullyIndexed,
    }
  }

  return {
    presentInKb: false,
    indexState: "not_indexed",
    sourceMembership,
    isFullyIndexed: false,
  }
}

export async function buildSearchLookup(
  deps: FilePickerDependencies,
  request: StatusOverlayRequest,
): Promise<ReturnType<typeof buildStatusLookup>> {
  if (request.mode !== "search" || !request.query?.trim()) {
    return buildStatusLookup([])
  }

  const resources = await searchKnowledgeBaseResources(
    deps.config,
    request.query.trim(),
  )
  return buildStatusLookup(resources)
}

export async function resolveSingleItemKnowledgeBaseSnapshot(
  deps: FilePickerDependencies,
  binding: ResolvedBinding,
  item: ResourceDescriptor,
): Promise<StatusSnapshot> {
  if (!binding.details) {
    return {
      presentInKb: false,
      indexState: "unknown",
      sourceMembership: "unknown",
      isFullyIndexed: false,
    }
  }

  const sourceState = await resolveKnowledgeBaseSourceState(deps, binding.details, {
    includeResolvedFolders: item.type === "folder",
  })
  const parentResources = await listKnowledgeBaseChildrenForOverlay(
    deps,
    getParentPath(item.resourcePath),
  )
  const lookup = buildStatusLookup(parentResources)
  const materializedResource = resolveMaterializedResource(lookup, item)
  const presentInKbTree = isPresentInKnowledgeBaseTree(parentResources, item)

  return resolveStatusSnapshot({
    item,
    materializedResource,
    presentInKbTree,
    sourceState,
    mode: "browse",
  })
}
