import type { ItemActionPayload, ItemActionResponse } from "@/lib/drive-types"
import { FilePickerServerError } from "@/server/file-picker/errors"
import { getProductionDependencies } from "@/server/file-picker/dependencies"
import {
  deindexResourceFromKnowledgeBase,
  indexResourceInKnowledgeBase,
  targetResourceFromPayload,
} from "@/server/file-picker/knowledge-base-actions"
import {
  requireReadyBinding,
  resolveKnowledgeBaseBinding,
  resolveSingleItemKnowledgeBaseSnapshot,
} from "@/server/file-picker/knowledge-base-state"
import type { FilePickerDependencies } from "@/server/file-picker/runtime-types"

export async function applyItemAction(
  payload: ItemActionPayload,
  dependencies?: FilePickerDependencies,
): Promise<ItemActionResponse> {
  const deps = dependencies ?? getProductionDependencies()
  const resource = targetResourceFromPayload(payload)
  const hiddenIds = await deps.hiddenItemsRepository.getHiddenResourceIds(
    deps.config.connectionId,
    [resource.id],
  )
  const isHidden = hiddenIds.has(resource.id)

  if (payload.action === "restore") {
    await deps.hiddenItemsRepository.restoreItem(deps.config.connectionId, resource.id)
    return {
      action: "restore",
      affectedIds: [resource.id],
    }
  }

  if (isHidden) {
    throw new FilePickerServerError(
      "Hidden items must be restored before applying this action.",
      {
        status: 409,
        code: "hidden_item",
      },
    )
  }

  if (payload.action === "index") {
    const knowledgeBase = requireReadyBinding(await resolveKnowledgeBaseBinding(deps))
    if (knowledgeBase.connectionSourceIds.includes(resource.id)) {
      throw new FilePickerServerError("This item is already indexed directly.", {
        status: 409,
        code: "already_indexed_direct",
      })
    }

    await indexResourceInKnowledgeBase({
      deps,
      knowledgeBase,
      resourceId: resource.id,
    })

    return {
      action: "index",
      affectedIds: [resource.id],
    }
  }

  if (payload.action === "deindex") {
    const binding = await resolveKnowledgeBaseBinding(deps)
    const knowledgeBase = requireReadyBinding(binding)
    const snapshot = await resolveSingleItemKnowledgeBaseSnapshot(
      deps,
      binding,
      resource,
    )
    const exactSourceSelected = knowledgeBase.connectionSourceIds.includes(resource.id)

    if (!snapshot.presentInKb && !exactSourceSelected) {
      throw new FilePickerServerError("This item is not in the knowledge base.", {
        status: 409,
        code: "not_indexed",
      })
    }

    await deindexResourceFromKnowledgeBase({
      deps,
      knowledgeBase,
      resource,
    })

    return {
      action: "deindex",
      affectedIds: [resource.id],
    }
  }

  if (resource.type !== "file") {
    throw new FilePickerServerError("Only files can be removed from listing.", {
      status: 409,
      code: "unsupported_item_type",
    })
  }

  const binding = await resolveKnowledgeBaseBinding(deps)
  if (!binding.details) {
    await deps.hiddenItemsRepository.hideItem({
      connectionId: deps.config.connectionId,
      resourceId: resource.id,
      resourcePath: resource.resourcePath,
    })

    return {
      action: "unlist",
      affectedIds: [resource.id],
    }
  }

  const knowledgeBase = binding.details
  const snapshot = await resolveSingleItemKnowledgeBaseSnapshot(
    deps,
    binding,
    resource,
  )
  const exactSourceSelected = knowledgeBase.connectionSourceIds.includes(resource.id)

  if (snapshot.presentInKb || exactSourceSelected) {
    await deindexResourceFromKnowledgeBase({
      deps,
      knowledgeBase,
      resource,
    })
  }

  try {
    await deps.hiddenItemsRepository.hideItem({
      connectionId: deps.config.connectionId,
      resourceId: resource.id,
      resourcePath: resource.resourcePath,
    })
  } catch (error) {
    deps.log.error("partial_unlist_failure", {
      itemId: resource.id,
      connectionId: deps.config.connectionId,
      error,
    })

    throw new FilePickerServerError(
      "The item was de-indexed but could not be hidden from listing.",
      {
        status: 500,
        code: "partial_unlist_failure",
      },
    )
  }

  return {
    action: "unlist",
    affectedIds: [resource.id],
  }
}
