"use client"

import * as React from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  HardDriveDownloadIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useFolderItems, usePrefetchFolderItems } from "@/features/file-picker/hooks"
import { useFilePickerStore } from "@/features/file-picker/store"
import { ROOT_FOLDER_ID, type DriveItem } from "@/lib/drive-types"
import { cn } from "@/lib/utils"
import { useShallow } from "zustand/react/shallow"

type FolderTreeVariant = "desktop" | "mobile"

interface FolderNodeProps {
  folder: DriveItem
  depth: number
  showFiles: boolean
  variant: FolderTreeVariant
}

function getFolders(items: readonly DriveItem[]): DriveItem[] {
  return items.filter((item) => item.type === "folder")
}

function getFiles(items: readonly DriveItem[]): DriveItem[] {
  return items.filter((item) => item.type === "file")
}

const FolderNode = React.memo(function FolderNode({
  folder,
  depth,
  showFiles,
  variant,
}: Readonly<FolderNodeProps>): React.JSX.Element {
  const {
    isSelected,
    setSelectedFolder,
    toggleExpandedFolder,
    ensureExpandedFolder,
    isExpanded,
  } = useFilePickerStore(
    useShallow((state) => ({
      isSelected: state.selectedFolderId === folder.id,
      setSelectedFolder: state.setSelectedFolder,
      toggleExpandedFolder: state.toggleExpandedFolder,
      ensureExpandedFolder: state.ensureExpandedFolder,
      isExpanded: state.expandedFolderIds.includes(folder.id),
    })),
  )
  const prefetchFolderItems = usePrefetchFolderItems()
  const isMobileVariant = variant === "mobile"

  const query = useFolderItems(folder.id, {
    enabled: isExpanded,
    parentPath: folder.resourcePath,
  })
  const childFolders = React.useMemo(
    () => getFolders(query.data?.items ?? []),
    [query.data?.items],
  )
  const childFiles = React.useMemo(
    () => getFiles(query.data?.items ?? []),
    [query.data?.items],
  )

  const handleSelectFolder = React.useCallback(() => {
    setSelectedFolder(folder.id, folder.name, folder.resourcePath ?? "/")
    ensureExpandedFolder(folder.id)
  }, [ensureExpandedFolder, folder.id, folder.name, folder.resourcePath, setSelectedFolder])
  const handleFolderIntent = React.useCallback(() => {
    if (isExpanded) {
      return
    }
    void prefetchFolderItems(folder.id, folder.resourcePath ?? "/")
  }, [folder.id, folder.resourcePath, isExpanded, prefetchFolderItems])
  const handleLoadMore = React.useCallback(() => {
    void query.fetchNextPage()
  }, [query])

  const rowIndent = isMobileVariant ? 8 + depth * 12 : 10 + depth * 14
  const contentIndentClass = isMobileVariant ? "pl-4" : "pl-11"

  return (
    <div className={cn(isMobileVariant && "space-y-2")}>
      <div
        className={cn(
          "group flex min-w-0 w-full items-center gap-0.5 box-border",
          isMobileVariant ? "min-h-11 pr-0" : "h-8 pr-2",
        )}
        style={{ paddingLeft: `${rowIndent}px` }}
      >
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "shrink-0 text-slate-500 hover:text-slate-700",
            isMobileVariant
              ? "size-7 rounded-full hover:bg-slate-100"
              : "size-6 rounded-md hover:bg-slate-300/40",
          )}
          onClick={() => toggleExpandedFolder(folder.id)}
          aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
        >
          {isExpanded ? (
            <ChevronDownIcon className="size-4" />
          ) : (
            <ChevronRightIcon className="size-4" />
          )}
        </Button>
        <button
          type="button"
          onClick={handleSelectFolder}
          onMouseEnter={handleFolderIntent}
          onFocus={handleFolderIntent}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 text-left font-medium transition-colors",
            isSelected
              ? "border-sky-300 bg-sky-50 text-sky-900"
              : "text-slate-700",
            isMobileVariant
              ? "min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300/80 hover:bg-slate-50"
              : "rounded-md px-2 py-1 text-[13px] hover:bg-slate-300/40",
          )}
        >
          {isExpanded ? (
            <FolderOpenIcon className={cn("shrink-0", isMobileVariant ? "size-[18px]" : "size-4")} />
          ) : (
            <FolderIcon className={cn("shrink-0", isMobileVariant ? "size-[18px]" : "size-4")} />
          )}
          <span className="truncate">{folder.name}</span>
        </button>
      </div>

      {isExpanded ? (
        <div
          className={cn(
            isMobileVariant
              ? "ml-4 min-w-0 space-y-2 border-l border-slate-200 pl-3"
              : undefined,
          )}
        >
          {query.isPending ? (
            <div className={cn("space-y-1.5 py-2 pr-2", contentIndentClass)}>
              <Skeleton className={cn(isMobileVariant ? "h-10 rounded-2xl" : "h-3.5 w-4/5")} />
              <Skeleton
                className={cn(
                  isMobileVariant ? "h-10 w-4/5 rounded-2xl" : "h-3.5 w-3/5",
                )}
              />
            </div>
          ) : null}

          {query.isError ? (
            <p className={cn("py-2 pr-2 text-[11px] text-destructive", contentIndentClass)}>
              {(query.error as Error).message}
            </p>
          ) : null}

          {!query.isPending &&
          !query.isError &&
          showFiles &&
          childFolders.length === 0 &&
          childFiles.length > 0 ? (
            <div className={cn("space-y-0.5 py-1 pr-2", contentIndentClass)}>
              {childFiles.map((file) => (
                <div
                  key={file.id}
                  className={cn(
                    "flex items-center gap-1.5 text-slate-600",
                    isMobileVariant
                      ? "min-h-10 rounded-xl border border-slate-200 bg-slate-50/80 px-3 text-[13px]"
                      : "h-7 rounded-md px-2 text-[12px]",
                  )}
                  title={file.name}
                >
                  <FileTextIcon className="size-3.5 shrink-0 text-slate-500" />
                  <span className="truncate">{file.name}</span>
                </div>
              ))}
            </div>
          ) : null}

          {!query.isPending &&
          !query.isError &&
          childFolders.length === 0 &&
          childFiles.length === 0 ? (
            <p className={cn("py-2 pr-2 text-[11px] text-slate-500", contentIndentClass)}>
              Empty folder
            </p>
          ) : null}

          {!query.isPending && !query.isError
            ? childFolders.map((childFolder) => (
                <FolderNode
                  key={childFolder.id}
                  folder={childFolder}
                  depth={depth + 1}
                  showFiles={showFiles}
                  variant={variant}
                />
              ))
            : null}

          {!query.isPending && !query.isError && query.hasMore ? (
            <div className={cn("py-2 pr-2", contentIndentClass)}>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "border-slate-300/80 bg-white text-slate-700",
                  isMobileVariant
                    ? "h-9 w-full rounded-xl px-3 text-sm"
                    : "h-7 rounded-md px-2 text-xs",
                )}
                onClick={handleLoadMore}
                disabled={query.isFetchingNextPage}
              >
                {query.isFetchingNextPage ? "Loading..." : "Load more folders"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

export function FolderTree({
  showFiles = true,
  showHeader = true,
  variant = "desktop",
}: Readonly<{
  showFiles?: boolean
  showHeader?: boolean
  variant?: FolderTreeVariant
}> = {}): React.JSX.Element {
  const { isRootSelected, setSelectedFolder } = useFilePickerStore(
    useShallow((state) => ({
      isRootSelected: state.selectedFolderId === ROOT_FOLDER_ID,
      setSelectedFolder: state.setSelectedFolder,
    })),
  )
  const rootQuery = useFolderItems(ROOT_FOLDER_ID, { parentPath: "/" })
  const isMobileVariant = variant === "mobile"

  const topLevelFolders = React.useMemo(
    () => getFolders(rootQuery.data?.items ?? []),
    [rootQuery.data?.items],
  )
  const topLevelFiles = React.useMemo(
    () => getFiles(rootQuery.data?.items ?? []),
    [rootQuery.data?.items],
  )
  const handleRootLoadMore = React.useCallback(() => {
    void rootQuery.fetchNextPage()
  }, [rootQuery])

  return (
    <div
      className={cn(
        "flex h-full flex-col",
        isMobileVariant && "bg-white",
      )}
    >
      {showHeader ? (
        <div className="border-b border-slate-300/80 px-4 py-3">
          <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            Drive Structure
          </p>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable]">
        <div className={cn(isMobileVariant ? "space-y-2.5 p-4" : "space-y-1 p-2.5")}>
          <button
            type="button"
            onClick={() => setSelectedFolder(ROOT_FOLDER_ID, "My Drive", "/")}
            className={cn(
              "flex w-full items-center gap-2 text-left font-medium transition-colors",
              isRootSelected
                ? "border-sky-300 bg-sky-50 text-sky-900"
                : "text-slate-700",
              isMobileVariant
                ? "min-h-11 rounded-xl border border-slate-200 bg-white px-3.5 text-[15px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300/80 hover:bg-slate-50"
                : "h-8 rounded-md px-2 text-[13px] hover:bg-slate-300/40",
            )}
          >
            <HardDriveDownloadIcon
              className={cn("shrink-0", isMobileVariant ? "size-[18px]" : "size-4")}
            />
            <span className="truncate">My Drive</span>
          </button>

          {rootQuery.isPending ? (
            <div className="space-y-1.5 py-2">
              <Skeleton className={cn(isMobileVariant ? "h-11 w-full rounded-xl" : "h-7 w-full")} />
              <Skeleton className={cn(isMobileVariant ? "h-11 w-full rounded-xl" : "h-7 w-full")} />
              <Skeleton className={cn(isMobileVariant ? "h-11 w-full rounded-xl" : "h-7 w-full")} />
            </div>
          ) : null}

          {rootQuery.isError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {(rootQuery.error as Error).message}
            </p>
          ) : null}

          {!rootQuery.isPending && !rootQuery.isError
            ? topLevelFolders.map((folder) => (
                <FolderNode
                  key={folder.id}
                  folder={folder}
                  depth={0}
                  showFiles={showFiles}
                  variant={variant}
                />
              ))
            : null}

          {!rootQuery.isPending &&
          !rootQuery.isError &&
          showFiles &&
          topLevelFolders.length === 0 &&
          topLevelFiles.length > 0 ? (
            <div className={cn("pt-1", isMobileVariant ? "space-y-2" : "space-y-0.5")}>
              {topLevelFiles.map((file) => (
                <div
                  key={file.id}
                  className={cn(
                    "flex items-center gap-1.5 text-slate-600",
                    isMobileVariant
                      ? "min-h-10 rounded-xl border border-slate-200 bg-slate-50/80 px-3 text-[13px]"
                      : "h-7 rounded-md px-2 text-[12px]",
                  )}
                  title={file.name}
                >
                  <FileTextIcon className="size-3.5 shrink-0 text-slate-500" />
                  <span className="truncate">{file.name}</span>
                </div>
              ))}
            </div>
          ) : null}

          {!rootQuery.isPending && !rootQuery.isError && rootQuery.hasMore ? (
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "w-full border-slate-300/80 bg-white text-slate-700",
                  isMobileVariant
                    ? "h-10 rounded-xl px-3 text-sm"
                    : "h-7 rounded-md px-2 text-xs",
                )}
                onClick={handleRootLoadMore}
                disabled={rootQuery.isFetchingNextPage}
              >
                {rootQuery.isFetchingNextPage ? "Loading..." : "Load more folders"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
