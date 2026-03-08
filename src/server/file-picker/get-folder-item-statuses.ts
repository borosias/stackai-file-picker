import type {
  StatusOverlayRequest,
  StatusOverlayResponse,
} from "@/lib/drive-types"
import { buildCapabilities, buildDisplayStatus } from "@/server/file-picker/domain"
import { getProductionDependencies } from "@/server/file-picker/dependencies"
import {
  buildSearchLookup,
  buildStatusLookup,
  isPresentInKnowledgeBaseTree,
  listKnowledgeBaseChildrenForOverlay,
  resolveKnowledgeBaseBinding,
  resolveKnowledgeBaseSourceState,
  resolveMaterializedResource,
  resolveStatusSnapshot,
} from "@/server/file-picker/knowledge-base-state"
import type { FilePickerDependencies } from "@/server/file-picker/runtime-types"

export async function getFolderItemStatuses(
  request: StatusOverlayRequest,
  dependencies?: FilePickerDependencies,
): Promise<StatusOverlayResponse> {
  const deps = dependencies ?? getProductionDependencies()
  const hiddenIds = await deps.hiddenItemsRepository.getHiddenResourceIds(
    deps.config.connectionId,
    request.items.map((item) => item.id),
  )
  const binding = await resolveKnowledgeBaseBinding(deps)

  if (!binding.details) {
    return {
      knowledgeBaseBinding: binding.public,
      itemsById: Object.fromEntries(
        request.items.map((item) => [
          item.id,
          {
            presentInKb: false,
            indexOrigin: "unknown",
            indexState: "unknown",
            isHidden: hiddenIds.has(item.id),
            displayStatus: buildDisplayStatus({
              binding: binding.public,
              itemType: item.type,
              indexState: "unknown",
              presentInKb: false,
              isFullyIndexed: false,
            }),
            capabilities: buildCapabilities({
              binding: binding.public,
              itemType: item.type,
              sourceMembership: "unknown",
              indexState: "unknown",
              presentInKb: false,
              isHidden: hiddenIds.has(item.id),
              isFullyIndexed: false,
            }),
          },
        ]),
      ),
    }
  }

  const hasFolderItems = request.items.some((item) => item.type === "folder")
  const sourceState = await resolveKnowledgeBaseSourceState(deps, binding.details, {
    includeResolvedFolders: hasFolderItems,
  })
  const browseResources =
    request.mode === "browse"
      ? await listKnowledgeBaseChildrenForOverlay(deps, request.parentPath ?? "/")
      : []
  const browseLookup = buildStatusLookup(browseResources)
  const searchLookup = await buildSearchLookup(deps, request)

  return {
    knowledgeBaseBinding: binding.public,
    itemsById: Object.fromEntries(
      request.items.map((item) => {
        const materializedResource =
          request.mode === "browse"
            ? resolveMaterializedResource(browseLookup, item)
            : resolveMaterializedResource(searchLookup, item)
        const presentInKbTree =
          request.mode === "browse"
            ? isPresentInKnowledgeBaseTree(browseResources, item)
            : false
        const { presentInKb, indexState, sourceMembership, isFullyIndexed } =
          resolveStatusSnapshot({
            item,
            materializedResource,
            presentInKbTree,
            sourceState,
            mode: request.mode,
          })
        const isHidden = hiddenIds.has(item.id)
        const folderDisplayVariant =
          item.type === "folder" && presentInKb
            ? isFullyIndexed
              ? "full"
              : request.mode === "browse"
                ? "partial"
                : "present"
            : undefined

        return [
          item.id,
          {
            presentInKb,
            indexOrigin: sourceMembership,
            indexState,
            isHidden,
            displayStatus: buildDisplayStatus({
              binding: binding.public,
              itemType: item.type,
              indexState,
              presentInKb,
              isFullyIndexed,
              folderDisplayVariant,
            }),
            capabilities: buildCapabilities({
              binding: binding.public,
              itemType: item.type,
              sourceMembership,
              indexState,
              presentInKb,
              isHidden,
              isFullyIndexed,
            }),
          },
        ]
      }),
    ),
  }
}
