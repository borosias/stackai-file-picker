"use client"

import * as React from "react"
import {
  FileTextIcon,
  FolderIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/features/file-picker/components/status-badge"
import { formatDateLabel, formatSizeLabel } from "@/features/file-picker/utils"
import type {
  ActionCapability,
  DisplayStatus,
  DriveItemCapabilities,
  ItemAction,
  StatusAwareDriveItem,
} from "@/lib/drive-types"
import { cn } from "@/lib/utils"

interface FileListProps {
  items: readonly StatusAwareDriveItem[]
  folderName: string
  hasMore?: boolean
  isPending: boolean
  isError: boolean
  errorMessage?: string
  pendingActionsByItemId?: Readonly<Record<string, ItemAction>>
  isFetchingNextPage?: boolean
  isSearchMode?: boolean
  showPath?: boolean
  onLoadMore?: () => void
  onOpenFolder: (folder: StatusAwareDriveItem) => void
  onPrefetchFolder?: (folderId: string, parentPath?: string) => void
  onAction: (item: StatusAwareDriveItem, action: ItemAction) => void
}

function primaryActionFor(item: StatusAwareDriveItem): ItemAction | null {
  if (item.capabilities.deindex.allowed) {
    return "deindex"
  }

  if (item.capabilities.index.allowed) {
    return "index"
  }

  return null
}

function hasSameDisplayStatus(
  left: DisplayStatus | undefined,
  right: DisplayStatus | undefined,
): boolean {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return (
    left.code === right.code &&
    left.label === right.label &&
    left.tone === right.tone &&
    left.kind === right.kind &&
    left.tooltip === right.tooltip
  )
}

function hasSameCapability(left: ActionCapability, right: ActionCapability): boolean {
  return (
    left.allowed === right.allowed &&
    left.reasonCode === right.reasonCode &&
    left.reasonMessage === right.reasonMessage
  )
}

function hasSameCapabilities(
  left: DriveItemCapabilities,
  right: DriveItemCapabilities,
): boolean {
  return (
    hasSameCapability(left.index, right.index) &&
    hasSameCapability(left.deindex, right.deindex) &&
    hasSameCapability(left.unlist, right.unlist) &&
    hasSameCapability(left.restore, right.restore)
  )
}

function hasSameRowData(left: StatusAwareDriveItem, right: StatusAwareDriveItem): boolean {
  if (left === right) {
    return true
  }

  return (
    left.id === right.id &&
    left.name === right.name &&
    left.type === right.type &&
    left.parentId === right.parentId &&
    left.resourcePath === right.resourcePath &&
    left.modifiedAt === right.modifiedAt &&
    left.sizeBytes === right.sizeBytes &&
    left.mimeType === right.mimeType &&
    left.indexState === right.indexState &&
    left.indexOrigin === right.indexOrigin &&
    left.isHidden === right.isHidden &&
    hasSameDisplayStatus(left.displayStatus, right.displayStatus) &&
    hasSameCapabilities(left.capabilities, right.capabilities)
  )
}

const FileRow = React.memo(function FileRow({
  item,
  isActionPending,
  showPath,
  onOpenFolder,
  onPrefetchFolder,
  onAction,
}: Readonly<{
  item: StatusAwareDriveItem
  isActionPending: boolean
  showPath?: boolean
  onOpenFolder: (folder: StatusAwareDriveItem) => void
  onPrefetchFolder?: (folderId: string, parentPath?: string) => void
  onAction: (item: StatusAwareDriveItem, action: ItemAction) => void
}>): React.JSX.Element {
  const desktopMenuTriggerId = `file-actions-desktop-trigger-${item.id}`
  const desktopMenuContentId = `file-actions-desktop-content-${item.id}`
  const mobileMenuTriggerId = `file-actions-mobile-trigger-${item.id}`
  const mobileMenuContentId = `file-actions-mobile-content-${item.id}`
  const rowAction = primaryActionFor(item)
  const waitingForAction =
    isActionPending ||
    item.indexState === "pending" ||
    item.indexState === "deindexing"
  const canDeindex = item.capabilities.deindex.allowed
  const canUnlist = item.capabilities.unlist.allowed
  const canIndex = item.capabilities.index.allowed
  const deindexLabel =
    item.capabilities.deindex.reasonMessage ?? "De-index"
  const unlistLabel =
    item.capabilities.unlist.reasonMessage ?? "Remove from listing"
  const indexLabel = item.capabilities.index.reasonMessage ?? "Index now"
  const handleFolderIntent = React.useCallback(() => {
    if (item.type !== "folder") {
      return
    }
    onPrefetchFolder?.(item.id, item.resourcePath ?? "/")
  }, [item.id, item.resourcePath, item.type, onPrefetchFolder])
  const handlePrimaryAction = React.useCallback(() => {
    if (!rowAction) {
      return
    }

    onAction(item, rowAction)
  }, [item, onAction, rowAction])

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm transition-colors hover:border-slate-300/80 hover:bg-white lg:min-w-[806px] lg:rounded-none lg:border-x-0 lg:border-b lg:border-t-0 lg:bg-transparent lg:px-2.5 lg:py-1 lg:shadow-none lg:hover:bg-slate-100/70">
      <div className="hidden min-h-10 min-w-[806px] grid-cols-[minmax(220px,2fr)_160px_100px_150px_176px] items-center gap-3 py-1 lg:grid">
        <button
          type="button"
          className="flex min-w-0 items-start gap-2 text-left"
          onClick={() => (item.type === "folder" ? onOpenFolder(item) : undefined)}
          onMouseEnter={handleFolderIntent}
          onFocus={handleFolderIntent}
          disabled={item.type !== "folder"}
        >
          {item.type === "folder" ? (
            <FolderIcon className="size-4 shrink-0 text-sky-700" />
          ) : (
            <FileTextIcon className="size-4 shrink-0 text-slate-500" />
          )}
          <span className="min-w-0">
            <span
              className={cn(
                "block truncate text-[13px] font-medium",
                item.type === "folder" ? "text-slate-800" : "text-slate-700",
              )}
            >
              {item.name}
            </span>
            {showPath && item.resourcePath ? (
              <span className="block truncate text-[11px] text-slate-500">
                {item.resourcePath}
              </span>
            ) : null}
          </span>
        </button>

        <span className="text-xs text-slate-500" suppressHydrationWarning>
          {formatDateLabel(item.modifiedAt)}
        </span>
        <span className="text-xs text-slate-500">{formatSizeLabel(item.sizeBytes)}</span>
        <StatusBadge displayStatus={item.displayStatus} />

        <div className="flex items-center justify-end gap-1">
          {item.type === "folder" ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onOpenFolder(item)}
              className="size-7 rounded-md text-slate-500 hover:bg-slate-200/80 hover:text-slate-700"
            >
              <FolderIcon className="size-3.5" />
            </Button>
          ) : null}

          <Button
            variant="ghost"
            size="icon-xs"
            className="size-7 rounded-md text-slate-500 hover:bg-slate-200/80 hover:text-slate-700"
            disabled={waitingForAction || !rowAction}
            onClick={handlePrimaryAction}
            aria-label={
              rowAction
                ? `${rowAction === "index" ? "Index" : "De-index"} ${item.name}`
                : item.capabilities.deindex.reasonMessage ??
                  item.capabilities.index.reasonMessage ??
                  `No primary action available for ${item.name}`
            }
            title={
              rowAction
                ? undefined
                : item.capabilities.deindex.reasonMessage ??
                  item.capabilities.index.reasonMessage
            }
          >
            {waitingForAction ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <WandSparklesIcon className="size-3.5" />
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-7 rounded-md text-slate-500 hover:bg-slate-200/80 hover:text-slate-700"
                disabled={waitingForAction}
                aria-label={`More actions for ${item.name}`}
                id={desktopMenuTriggerId}
              >
                <MoreHorizontalIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              id={desktopMenuContentId}
              aria-labelledby={desktopMenuTriggerId}
            >
              <DropdownMenuItem
                disabled={!canIndex}
                onClick={() => onAction(item, "index")}
              >
                {canIndex ? "Index now" : indexLabel}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canDeindex}
                onClick={() => onAction(item, "deindex")}
              >
                {canDeindex ? "De-index" : deindexLabel}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={!canUnlist}
                onClick={() => onAction(item, "unlist")}
              >
                <Trash2Icon className="size-4" />
                {canUnlist ? "Remove from listing" : unlistLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex h-full flex-col justify-center gap-3 py-0 lg:hidden">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-3 text-left"
            onClick={() => (item.type === "folder" ? onOpenFolder(item) : undefined)}
            onMouseEnter={handleFolderIntent}
            onFocus={handleFolderIntent}
            disabled={item.type !== "folder"}
          >
            {item.type === "folder" ? (
              <FolderIcon className="mt-0.5 size-4 shrink-0 text-sky-700" />
            ) : (
              <FileTextIcon className="mt-0.5 size-4 shrink-0 text-slate-500" />
            )}
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold text-slate-800">
                {item.name}
              </span>
              {showPath && item.resourcePath ? (
                <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                  {item.resourcePath}
                </span>
              ) : null}
            </span>
          </button>
          <div className="shrink-0">
            <StatusBadge displayStatus={item.displayStatus} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
          <span
            className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1"
            suppressHydrationWarning
          >
            {formatDateLabel(item.modifiedAt)}
          </span>
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1">
            {formatSizeLabel(item.sizeBytes)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {item.type === "folder" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenFolder(item)}
              className="h-9 flex-1 rounded-xl border-slate-300/80 bg-white px-3 text-sm text-slate-700 shadow-sm"
            >
              Open folder
            </Button>
          ) : null}
          <Button
            variant={rowAction === "deindex" ? "secondary" : "default"}
            size="sm"
            className="h-9 flex-1 rounded-xl px-3 text-sm shadow-sm"
            disabled={waitingForAction || !rowAction}
            onClick={handlePrimaryAction}
            title={
              rowAction
                ? undefined
                : item.capabilities.deindex.reasonMessage ??
                  item.capabilities.index.reasonMessage
            }
          >
            {waitingForAction ? (
              <>
                <Loader2Icon className="size-3 animate-spin" />
                Working
              </>
            ) : rowAction === "deindex" ? (
              "De-index"
            ) : rowAction === "index" ? (
              "Index"
            ) : (
              "Unavailable"
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                disabled={waitingForAction}
                aria-label={`More actions for ${item.name}`}
                id={mobileMenuTriggerId}
              >
                <MoreHorizontalIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              id={mobileMenuContentId}
              aria-labelledby={mobileMenuTriggerId}
            >
              <DropdownMenuItem
                disabled={!canIndex}
                onClick={() => onAction(item, "index")}
              >
                {canIndex ? "Index" : indexLabel}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canDeindex}
                onClick={() => onAction(item, "deindex")}
              >
                {canDeindex ? "De-index" : deindexLabel}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={!canUnlist}
                onClick={() => onAction(item, "unlist")}
              >
                <Trash2Icon className="size-4" />
                {canUnlist ? "Remove from listing" : unlistLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}, (prev, next) => {
  return (
    hasSameRowData(prev.item, next.item) &&
    prev.isActionPending === next.isActionPending &&
    prev.showPath === next.showPath &&
    prev.onOpenFolder === next.onOpenFolder &&
    prev.onPrefetchFolder === next.onPrefetchFolder &&
    prev.onAction === next.onAction
  )
})

function ListLoadingState(): React.JSX.Element {
  return (
    <div className="space-y-1.5 p-3">
      {Array.from({ length: 7 }).map((_, index) => (
        <Skeleton key={index} className="h-9 w-full rounded-md" />
      ))}
    </div>
  )
}

const FileListComponent = function FileList({
  items,
  folderName,
  hasMore,
  isPending,
  isError,
  errorMessage,
  pendingActionsByItemId,
  isFetchingNextPage,
  isSearchMode,
  showPath,
  onLoadMore,
  onOpenFolder,
  onPrefetchFolder,
  onAction,
}: Readonly<FileListProps>): React.JSX.Element {
  if (isPending) {
    return <ListLoadingState />
  }

  if (isError) {
    return (
      <div className="p-4">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {errorMessage ?? "Failed to load folder contents."}
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-sm rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-6 text-center">
          <p className="text-sm font-semibold text-slate-800">
            {isSearchMode ? "No search results" : "No items found"}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {isSearchMode ? (
              <>No matching files or folders were found in this Drive connection.</>
            ) : (
              <>
                This folder has no files matching current filters in{" "}
                <span className="font-medium text-slate-700">{folderName}</span>.
              </>
            )}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {hasMore ? (
        <div className="border-b border-amber-300/60 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-800">
          {isSearchMode
            ? `Loaded ${items.length} search results from the connection. Sorting applies to loaded results.`
            : `Loaded ${items.length} items from this folder. Sorting applies to loaded results.`}
        </div>
      ) : null}
      <div className="hidden h-9 min-w-[806px] grid-cols-[minmax(220px,2fr)_160px_100px_150px_176px] items-center gap-3 border-b border-slate-300/80 bg-[#f7f8fa] px-2.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase lg:grid">
        <span>Name</span>
        <span>Modified</span>
        <span>Size</span>
        <span>Status</span>
        <span className="text-right">Actions</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto overscroll-contain [scrollbar-gutter:stable]">
        <div className="space-y-3 bg-[#f6f7fb] p-3 lg:space-y-0 lg:bg-transparent lg:px-2">
          {items.map((item) => (
            <FileRow
              key={item.id}
              item={item}
              isActionPending={Boolean(pendingActionsByItemId?.[item.id])}
              showPath={showPath}
              onOpenFolder={onOpenFolder}
              onPrefetchFolder={onPrefetchFolder}
              onAction={onAction}
            />
          ))}
        </div>
      </div>
      {hasMore && onLoadMore ? (
        <div className="border-t border-slate-200 px-4 py-3">
          <Button
            variant="outline"
            className="w-full rounded-lg border-slate-300/80 bg-white text-slate-700 shadow-sm"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? (
              <>
                <Loader2Icon className="size-4 animate-spin" />
                Loading more
              </>
            ) : isSearchMode ? (
              "Load more results"
            ) : (
              "Load more"
            )}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export const FileList = React.memo(FileListComponent, (prev, next) => {
  return (
    prev.items === next.items &&
    prev.folderName === next.folderName &&
    prev.hasMore === next.hasMore &&
    prev.isPending === next.isPending &&
    prev.isError === next.isError &&
    prev.errorMessage === next.errorMessage &&
    prev.pendingActionsByItemId === next.pendingActionsByItemId &&
    prev.isFetchingNextPage === next.isFetchingNextPage &&
    prev.isSearchMode === next.isSearchMode &&
    prev.showPath === next.showPath &&
    prev.onLoadMore === next.onLoadMore &&
    prev.onOpenFolder === next.onOpenFolder &&
    prev.onPrefetchFolder === next.onPrefetchFolder &&
    prev.onAction === next.onAction
  )
})
