import type { FolderItemsResponse } from "@/lib/drive-types"
import { toDriveItem } from "@/server/file-picker/domain"
import { FilePickerServerError } from "@/server/file-picker/errors"
import {
  listConnectionChildren,
  searchConnectionResources,
} from "@/server/file-picker/adapters/stack-ai/connections-gateway"
import { getProductionDependencies } from "@/server/file-picker/dependencies"
import type {
  FilePickerDependencies,
  ListFolderOptions,
} from "@/server/file-picker/runtime-types"

const DEFAULT_PAGE_SIZE = 100

function normalizePageSize(pageSize: number | undefined): number {
  if (!pageSize || !Number.isFinite(pageSize)) {
    return DEFAULT_PAGE_SIZE
  }

  return Math.max(1, Math.min(DEFAULT_PAGE_SIZE, Math.floor(pageSize)))
}

export async function listFolderItems(
  parentId: string,
  options?: ListFolderOptions,
  dependencies?: FilePickerDependencies,
): Promise<FolderItemsResponse> {
  if (!parentId.trim()) {
    throw new FilePickerServerError("Folder id cannot be empty.", {
      status: 400,
      code: "validation_error",
    })
  }

  const deps = dependencies ?? getProductionDependencies()
  const pageSize = normalizePageSize(options?.pageSize)

  const page = options?.query?.trim()
    ? await searchConnectionResources(deps.config, {
        query: options.query.trim(),
        cursor: options.cursor,
        pageSize,
      })
    : await listConnectionChildren(deps.config, {
        parentId,
        cursor: options?.cursor,
        pageSize,
      })

  const hiddenIds = await deps.hiddenItemsRepository.getHiddenResourceIds(
    deps.config.connectionId,
    page.items.map((item) => item.id),
  )

  const items = page.items
    .map((item) => toDriveItem(item, hiddenIds.has(item.id)))
    .filter((item) => options?.includeHidden || !item.isHidden)

  return {
    parentId,
    connectionId: deps.config.connectionId,
    items,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  }
}
