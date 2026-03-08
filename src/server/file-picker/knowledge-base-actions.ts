import { getParentPath, type ResourceDescriptor } from "@/server/file-picker/domain"
import { invalidateKnowledgeBaseCaches } from "@/server/file-picker/cache"
import { toHttpError } from "@/server/file-picker/errors"
import {
  bulkDeleteKnowledgeBaseResources,
  deleteKnowledgeBaseResourceByPath,
  syncKnowledgeBase,
  updateKnowledgeBaseSources,
  type KnowledgeBaseDetails,
} from "@/server/file-picker/adapters/stack-ai/knowledge-bases-gateway"
import type { FilePickerDependencies } from "@/server/file-picker/runtime-types"
import type { ItemActionPayload } from "@/lib/drive-types"

export function targetResourceFromPayload(payload: ItemActionPayload): ResourceDescriptor {
  return {
    id: payload.itemId,
    name: payload.resourcePath.split("/").filter(Boolean).at(-1) ?? payload.itemId,
    type: payload.itemType,
    parentId: "unknown",
    resourcePath: payload.resourcePath,
    modifiedAt: new Date(0).toISOString(),
    sizeBytes: null,
    mimeType: null,
  }
}

function toBulkDeleteInodeId(resourcePath: string): string {
  return getParentPath(resourcePath) === "/" && resourcePath.startsWith("/")
    ? resourcePath.slice(1)
    : resourcePath.replace(/^\/+/, "")
}

async function deleteKnowledgeBasePath(
  deps: FilePickerDependencies,
  knowledgeBaseId: string,
  resourcePath: string,
  options?: {
    tolerateNotFound?: boolean
  },
): Promise<void> {
  try {
    await deleteKnowledgeBaseResourceByPath(
      deps.config,
      knowledgeBaseId,
      resourcePath,
    )
  } catch (error) {
    const httpError = toHttpError(error)
    if (options?.tolerateNotFound && httpError.status === 404) {
      return
    }

    throw error
  }
}

async function deleteKnowledgeBaseFolder(
  deps: FilePickerDependencies,
  knowledgeBaseId: string,
  resourcePath: string,
  options?: {
    tolerateNotFound?: boolean
  },
): Promise<void> {
  try {
    await bulkDeleteKnowledgeBaseResources(
      deps.config,
      knowledgeBaseId,
      [toBulkDeleteInodeId(resourcePath)],
    )
  } catch (error) {
    const httpError = toHttpError(error)
    if (options?.tolerateNotFound && httpError.status === 404) {
      return
    }

    throw error
  }
}

async function deleteItemFromKnowledgeBase(
  deps: FilePickerDependencies,
  knowledgeBaseId: string,
  resource: ResourceDescriptor,
  options?: {
    tolerateNotFound?: boolean
  },
): Promise<void> {
  if (resource.type === "folder") {
    await deleteKnowledgeBaseFolder(
      deps,
      knowledgeBaseId,
      resource.resourcePath,
      options,
    )
    return
  }

  await deleteKnowledgeBasePath(
    deps,
    knowledgeBaseId,
    resource.resourcePath,
    options,
  )
}

async function removeExactSourceIfPresent(
  deps: FilePickerDependencies,
  knowledgeBase: KnowledgeBaseDetails,
  resourceId: string,
): Promise<KnowledgeBaseDetails> {
  if (!knowledgeBase.connectionSourceIds.includes(resourceId)) {
    return knowledgeBase
  }

  return updateKnowledgeBaseSources(
    deps.config,
    knowledgeBase,
    knowledgeBase.connectionSourceIds.filter((id) => id !== resourceId),
  )
}

export async function indexResourceInKnowledgeBase(args: {
  deps: FilePickerDependencies
  knowledgeBase: KnowledgeBaseDetails
  resourceId: string
}): Promise<void> {
  const updatedKnowledgeBase = await updateKnowledgeBaseSources(
    args.deps.config,
    args.knowledgeBase,
    [...args.knowledgeBase.connectionSourceIds, args.resourceId],
  )
  // Updating `connection_source_ids` only changes desired state. StackAI applies
  // the actual KB changes asynchronously after an explicit sync.
  await syncKnowledgeBase(args.deps.config, updatedKnowledgeBase.knowledgeBaseId)
  invalidateKnowledgeBaseCaches(updatedKnowledgeBase.knowledgeBaseId)
}

export async function deindexResourceFromKnowledgeBase(args: {
  deps: FilePickerDependencies
  knowledgeBase: KnowledgeBaseDetails
  resource: ResourceDescriptor
}): Promise<void> {
  // Match dashboard behavior: remove the concrete KB rows first, then reconcile
  // exact source membership, then trigger a sync for source-driven rebuilds.
  await deleteItemFromKnowledgeBase(
    args.deps,
    args.knowledgeBase.knowledgeBaseId,
    args.resource,
    { tolerateNotFound: true },
  )

  const updatedKnowledgeBase = await removeExactSourceIfPresent(
    args.deps,
    args.knowledgeBase,
    args.resource.id,
  )

  await syncKnowledgeBase(args.deps.config, updatedKnowledgeBase.knowledgeBaseId)
  invalidateKnowledgeBaseCaches(updatedKnowledgeBase.knowledgeBaseId)
}
