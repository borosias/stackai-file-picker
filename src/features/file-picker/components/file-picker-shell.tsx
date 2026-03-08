"use client"

import * as React from "react"
import {
  AlertTriangleIcon,
  ArrowDownAZIcon,
  ArrowUpZAIcon,
  Columns2Icon,
  FolderSearchIcon,
  InfoIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FileList } from "@/features/file-picker/components/file-list"
import { FolderTree } from "@/features/file-picker/components/folder-tree"
import {
  FORCED_STATUS_REFETCH_INTERVAL_MS,
  mergeItemsWithStatuses,
  useFolderItems,
  useFolderItemStatuses,
  useItemActionMutation,
  usePrefetchFolderItems,
} from "@/features/file-picker/hooks"
import {
  folderChildrenKey,
  folderStatusKey,
} from "@/features/file-picker/query-keys"
import { useFilePickerStore } from "@/features/file-picker/store"
import {
  filterAndSortItems,
  type ListControls,
} from "@/features/file-picker/utils"
import type {
  ItemAction,
  StatusOverlayResponse,
  StatusAwareDriveItem,
  SortBy,
  SortDirection,
  TypeFilter,
} from "@/lib/drive-types"
import { useShallow } from "zustand/react/shallow"

const SORT_BY_OPTIONS: readonly SortBy[] = ["name", "date"]
const SORT_DIRECTION_OPTIONS: readonly SortDirection[] = ["asc", "desc"]
const TYPE_FILTER_OPTIONS: readonly TypeFilter[] = ["all", "file", "folder"]
const STATUS_OVERLAY_DEFER_MS = 120
const EMPTY_ITEMS: readonly StatusAwareDriveItem[] = []

function asSortBy(value: string | null): SortBy {
  return SORT_BY_OPTIONS.includes(value as SortBy) ? (value as SortBy) : "name"
}

function asSortDirection(value: string | null): SortDirection {
  return SORT_DIRECTION_OPTIONS.includes(value as SortDirection)
    ? (value as SortDirection)
    : "asc"
}

function asTypeFilter(value: string | null): TypeFilter {
  return TYPE_FILTER_OPTIONS.includes(value as TypeFilter)
    ? (value as TypeFilter)
    : "all"
}

function useListControls(): {
  controls: ListControls
  setControl: (key: "q" | "sort" | "dir" | "type", value: string) => void
  resetControls: () => void
} {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  const controls = React.useMemo<ListControls>(() => {
    return {
      query: searchParams.get("q") ?? "",
      sortBy: asSortBy(searchParams.get("sort")),
      sortDirection: asSortDirection(searchParams.get("dir")),
      typeFilter: asTypeFilter(searchParams.get("type")),
    }
  }, [searchParams])

  const setControl = React.useCallback(
    (key: "q" | "sort" | "dir" | "type", value: string) => {
      const params = new URLSearchParams(searchParams.toString())

      const isDefaultValue =
        (key === "q" && !value) ||
        (key === "sort" && value === "name") ||
        (key === "dir" && value === "asc") ||
        (key === "type" && value === "all")

      if (isDefaultValue) {
        params.delete(key)
      } else {
        params.set(key, value)
      }

      const queryString = params.toString()
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
        scroll: false,
      })
    },
    [pathname, router, searchParams],
  )

  const resetControls = React.useCallback(() => {
    router.replace(pathname, { scroll: false })
  }, [pathname, router])

  return {
    controls,
    setControl,
    resetControls,
  }
}

function bindingTone(state: "ready" | "missing_config" | "not_found" | "connection_mismatch") {
  if (state === "ready") {
    return null
  }

  if (state === "missing_config") {
    return {
      border: "border-sky-200",
      background: "bg-sky-50",
      text: "text-sky-800",
      icon: InfoIcon,
    }
  }

  return {
    border: "border-rose-200",
    background: "bg-rose-50",
    text: "text-rose-700",
    icon: AlertTriangleIcon,
  }
}

function resolveOverlayItem(
  overlay: StatusOverlayResponse | undefined,
  itemId: string,
) {
  return overlay?.itemsById[itemId]
}

function hasActiveTransitions(
  transitions: Readonly<Record<string, { action: ItemAction; itemType: StatusAwareDriveItem["type"] }>>,
): boolean {
  return Object.keys(transitions).length > 0
}

function isTransitionComplete(args: {
  itemId: string
  transition: { action: ItemAction; itemType: StatusAwareDriveItem["type"] }
  folderItems: readonly { id: string }[]
  overlay: StatusOverlayResponse | undefined
}): boolean {
  const overlayItem = resolveOverlayItem(args.overlay, args.itemId)
  const itemInList = args.folderItems.some((item) => item.id === args.itemId)

  if (args.transition.action === "index") {
    if (!overlayItem) {
      return false
    }

    return (
      overlayItem.presentInKb ||
      overlayItem.displayStatus.code === "error"
    )
  }

  if (args.transition.action === "deindex") {
    return Boolean(
      overlayItem &&
        !overlayItem.presentInKb &&
        overlayItem.displayStatus.code === "not_in_kb",
    )
  }

  if (args.transition.action === "unlist") {
    return !itemInList
  }

  if (args.transition.action === "restore") {
    return itemInList || (overlayItem ? !overlayItem.isHidden : false)
  }

  return false
}

export function FilePickerShell(): React.JSX.Element {
  const { selectedFolderId, selectedFolderName, selectedFolderPath, setSelectedFolder } =
    useFilePickerStore(
      useShallow((state) => ({
        selectedFolderId: state.selectedFolderId,
        selectedFolderName: state.selectedFolderName,
        selectedFolderPath: state.selectedFolderPath,
        setSelectedFolder: state.setSelectedFolder,
      })),
    )

  const { controls, setControl, resetControls } = useListControls()
  const isSearchMode = controls.query.trim().length > 0
  const activeListQueryKey = React.useMemo(
    () =>
      folderChildrenKey({
        parentId: selectedFolderId,
        parentPath: selectedFolderPath,
        query: isSearchMode ? controls.query.trim() : undefined,
      }),
    [controls.query, isSearchMode, selectedFolderId, selectedFolderPath],
  )
  const folderQuery = useFolderItems(selectedFolderId, {
    parentPath: selectedFolderPath,
    query: isSearchMode ? controls.query : undefined,
  })
  const folderItems = React.useMemo(
    () => folderQuery.data?.items ?? EMPTY_ITEMS,
    [folderQuery.data?.items],
  )
  const folderItemIds = React.useMemo(
    () => folderItems.map((item) => item.id),
    [folderItems],
  )
  const folderItemIdsKey = React.useMemo(
    () => folderItemIds.join(","),
    [folderItemIds],
  )
  const activeStatusQueryKey = React.useMemo(
    () =>
      folderStatusKey({
        mode: isSearchMode ? "search" : "browse",
        parentPath: isSearchMode ? undefined : selectedFolderPath,
        query: isSearchMode ? controls.query : undefined,
        itemIds: folderItemIds,
      }),
    [
      controls.query,
      folderItemIds,
      isSearchMode,
      selectedFolderPath,
    ],
  )
  const statusOverlayContextKey = React.useMemo(
    () =>
      JSON.stringify({
        folderId: selectedFolderId,
        folderPath: selectedFolderPath,
        mode: isSearchMode ? "search" : "browse",
        query: isSearchMode ? controls.query.trim() : "",
        itemIdsKey: folderItemIdsKey,
      }),
    [
      controls.query,
      folderItemIdsKey,
      isSearchMode,
      selectedFolderId,
      selectedFolderPath,
    ],
  )
  const [isStatusOverlayEnabled, setIsStatusOverlayEnabled] = React.useState(false)

  React.useEffect(() => {
    if (
      folderQuery.isPending ||
      folderQuery.isError ||
      (folderQuery.data?.items.length ?? 0) === 0
    ) {
      setIsStatusOverlayEnabled(false)
      return
    }

    setIsStatusOverlayEnabled(false)
    const timeoutId = window.setTimeout(() => {
      setIsStatusOverlayEnabled(true)
    }, STATUS_OVERLAY_DEFER_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    folderQuery.data?.items.length,
    folderQuery.isError,
    folderQuery.isPending,
    statusOverlayContextKey,
  ])

  const statusQuery = useFolderItemStatuses({
    mode: isSearchMode ? "search" : "browse",
    parentPath: isSearchMode ? undefined : selectedFolderPath,
    query: isSearchMode ? controls.query : undefined,
    items: folderItems,
    enabled:
      !folderQuery.isPending &&
      !folderQuery.isError &&
      isStatusOverlayEnabled,
  })
  const prefetchFolderItems = usePrefetchFolderItems()
  const itemActionMutation = useItemActionMutation({
    activeListQueryKey,
    activeStatusQueryKey,
  })
  const mutateItemAction = itemActionMutation.mutate
  const clearCompletedTransition = itemActionMutation.clearCompletedTransition
  const activeTransitionsByItemId = itemActionMutation.activeTransitionsByItemId
  const transientStatusesByItemId = itemActionMutation.transientStatusesByItemId
  const refetchFolderItems = folderQuery.refetch
  const refetchFolderStatuses = statusQuery.refetch
  const [searchDraft, setSearchDraft] = React.useState(controls.query)
  const [isMobileFoldersOpen, setIsMobileFoldersOpen] = React.useState(false)
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = React.useState(false)
  const [hasMounted, setHasMounted] = React.useState(false)

  React.useEffect(() => {
    setHasMounted(true)
  }, [])

  React.useEffect(() => {
    setSearchDraft(controls.query)
  }, [controls.query])

  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchDraft !== controls.query) {
        setControl("q", searchDraft)
      }
    }, 180)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [controls.query, searchDraft, setControl])

  const deferredSearchQuery = React.useDeferredValue(searchDraft)
  const effectiveControls = React.useMemo<ListControls>(
    () => ({
      ...controls,
      query: isSearchMode ? "" : deferredSearchQuery,
    }),
    [controls, deferredSearchQuery, isSearchMode],
  )

  const hasMutationTransitions = React.useMemo(
    () => hasActiveTransitions(activeTransitionsByItemId),
    [activeTransitionsByItemId],
  )
  const transitionsChangeListMembership = React.useMemo(
    () =>
      Object.values(activeTransitionsByItemId).some(
        (transition) =>
          transition.action === "unlist" || transition.action === "restore",
      ),
    [activeTransitionsByItemId],
  )

  React.useEffect(() => {
    if (!hasMutationTransitions) {
      return
    }

    const poll = () => {
      if (transitionsChangeListMembership) {
        void Promise.all([refetchFolderItems(), refetchFolderStatuses()])
        return
      }

      void refetchFolderStatuses()
    }

    poll()
    const intervalId = window.setInterval(poll, FORCED_STATUS_REFETCH_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [
    hasMutationTransitions,
    refetchFolderItems,
    refetchFolderStatuses,
    transitionsChangeListMembership,
  ])

  const overlayItems = React.useMemo(
    () =>
      mergeItemsWithStatuses(
        folderItems,
        statusQuery.data,
        transientStatusesByItemId,
      ),
    [folderItems, statusQuery.data, transientStatusesByItemId],
  )
  const hasMoreInSource = folderQuery.data?.hasMore ?? false
  const visibleItems = React.useMemo(
    () => filterAndSortItems(overlayItems, effectiveControls),
    [effectiveControls, overlayItems],
  )

  const hasActiveControls =
    searchDraft.trim().length > 0 ||
    controls.sortBy !== "name" ||
    controls.sortDirection !== "asc" ||
    controls.typeFilter !== "all"

  const { indexedCount, pendingCount } = React.useMemo(() => {
    let indexed = 0
    let pending = 0

    for (const item of visibleItems) {
      if (
        item.displayStatus?.code === "in_kb" ||
        item.displayStatus?.code === "partially_in_kb"
      ) {
        indexed += 1
      } else if (
        item.displayStatus?.code === "syncing" ||
        item.displayStatus?.code === "removing"
      ) {
        pending += 1
      }
    }

    return {
      indexedCount: indexed,
      pendingCount: pending,
    }
  }, [visibleItems])
  const isStatusOverlayError =
    !folderQuery.isPending &&
    !folderQuery.isError &&
    folderItems.length > 0 &&
    statusQuery.isError
  const statusOverlayErrorMessage =
    statusQuery.error?.message ?? "Failed to load knowledge base status."
  const isStatusOverlayLoading =
    (folderQuery.data?.items.length ?? 0) > 0 &&
    (!isStatusOverlayEnabled || (statusQuery.isPending && !statusQuery.data))

  const handleResetControls = React.useCallback(() => {
    setSearchDraft("")
    resetControls()
  }, [resetControls])

  const handleOpenFolder = React.useCallback(
    (item: { id: string; name: string; resourcePath?: string; type: string }) => {
      if (item.type !== "folder") {
        return
      }

      if (controls.query) {
        setSearchDraft("")
        setControl("q", "")
      }

      setSelectedFolder(item.id, item.name, item.resourcePath ?? "/")
      setIsMobileFoldersOpen(false)
    },
    [controls.query, setControl, setSelectedFolder],
  )

  const handleAction = React.useCallback(
    (item: StatusAwareDriveItem, action: ItemAction) => {
      mutateItemAction({
        itemId: item.id,
        action,
        itemType: item.type,
        resourcePath: item.resourcePath!,
        parentId: selectedFolderId,
        item,
      })
    },
    [mutateItemAction, selectedFolderId],
  )

  const handlePrefetchFolder = React.useCallback(
    (folderId: string, parentPath?: string) => {
      void prefetchFolderItems(folderId, parentPath)
    },
    [prefetchFolderItems],
  )

  const handleLoadMore = React.useCallback(() => {
    void folderQuery.fetchNextPage()
  }, [folderQuery])

  React.useEffect(() => {
    const currentItems = folderQuery.data?.items ?? []

    for (const [itemId, transition] of Object.entries(
      activeTransitionsByItemId,
    )) {
      if (
        isTransitionComplete({
          itemId,
          transition,
          folderItems: currentItems,
          overlay: statusQuery.data,
        })
      ) {
        clearCompletedTransition(itemId)
      }
    }
  }, [
    activeTransitionsByItemId,
    clearCompletedTransition,
    folderQuery.data?.items,
    statusQuery.data,
  ])

  const knowledgeBaseBinding = statusQuery.knowledgeBaseBinding
  const bindingToneConfig =
    knowledgeBaseBinding ? bindingTone(knowledgeBaseBinding.state) : null
  const BindingIcon = bindingToneConfig?.icon

  return (
    <div className="h-screen bg-[#f2f4f8]">
      <div className="flex h-full w-full flex-col bg-white">
        <header className="border-b border-slate-200 bg-slate-50 px-4 py-2 sm:px-5">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-2">
                  <p className="text-[13px] font-semibold text-slate-700 sm:text-[15px]">
                    Google Drive Picker
                  </p>
                  <div className="inline-flex max-w-full w-fit items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-[12px] text-slate-600 shadow-sm">
                    <FolderSearchIcon className="mr-1.5 size-3 text-slate-500" />
                    <span className="truncate">{selectedFolderName}</span>
                  </div>
                </div>
              </div>

              <div className="flex w-full flex-wrap gap-2 text-[12px] sm:w-auto sm:justify-end">
                <div className="inline-flex min-w-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-slate-600 shadow-sm sm:py-1.5">
                  <span className="truncate text-[12px] font-medium text-slate-500">
                    Visible
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                    {visibleItems.length}
                  </span>
                </div>
                <div className="inline-flex min-w-0 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700 shadow-sm sm:py-1.5">
                  <span className="truncate text-[12px] font-medium text-emerald-700">
                    In KB
                  </span>
                  {isStatusOverlayError ? (
                    <span className="shrink-0 font-semibold text-emerald-900">Unavailable</span>
                  ) : isStatusOverlayLoading ? (
                    <span className="shrink-0 inline-block h-4 w-7 animate-pulse rounded bg-emerald-200/80 align-middle" />
                  ) : (
                    <span className="shrink-0 font-semibold tabular-nums text-emerald-900">
                      {indexedCount}
                    </span>
                  )}
                </div>
                <div className="inline-flex min-w-0 items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700 shadow-sm sm:py-1.5">
                  <span className="truncate text-[12px] font-medium text-amber-700">
                    Updating
                  </span>
                  {isStatusOverlayError ? (
                    <span className="shrink-0 font-semibold text-amber-900">Unavailable</span>
                  ) : isStatusOverlayLoading ? (
                    <span className="shrink-0 inline-block h-4 w-7 animate-pulse rounded bg-amber-200/80 align-middle" />
                  ) : (
                    <span className="shrink-0 font-semibold tabular-nums text-amber-900">
                      {pendingCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-slate-300/80 bg-[#f2f4f8] px-4 py-3 sm:px-5">
            <div className="hidden flex-col gap-3 lg:flex xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-1.5 rounded-md border border-slate-300/80 bg-white px-2 py-1 text-xs text-slate-600 shadow-sm">
                  <Columns2Icon className="size-3.5" />
                  List
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-md border border-slate-300/80 bg-white px-2 py-1 text-xs text-slate-600 shadow-sm">
                  <SlidersHorizontalIcon className="size-3.5" />
                  Controls
                </div>
              </div>

              {hasMounted ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                  <div className="relative w-full sm:w-60">
                    <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      value={searchDraft}
                      onChange={(event) => setSearchDraft(event.target.value)}
                      placeholder="Search"
                      suppressHydrationWarning
                      className="h-9 rounded-lg border-slate-300/80 bg-white pl-9 shadow-sm"
                    />
                  </div>

                  <Select
                    value={controls.typeFilter}
                    onValueChange={(value) => setControl("type", value)}
                  >
                    <SelectTrigger
                      aria-controls="picker-type-filter-content"
                      className="h-9 w-full rounded-lg border-slate-300/80 bg-white shadow-sm sm:w-34.5"
                    >
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent id="picker-type-filter-content">
                      <SelectItem value="all">All items</SelectItem>
                      <SelectItem value="file">Files only</SelectItem>
                      <SelectItem value="folder">Folders only</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={controls.sortBy}
                    onValueChange={(value) => setControl("sort", value)}
                  >
                    <SelectTrigger
                      aria-controls="picker-sort-by-content"
                      className="h-9 w-full rounded-lg border-slate-300/80 bg-white shadow-sm sm:w-31"
                    >
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent id="picker-sort-by-content">
                      <SelectItem value="name">Name</SelectItem>
                      <SelectItem value="date">Date</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={controls.sortDirection}
                    onValueChange={(value) => setControl("dir", value)}
                  >
                    <SelectTrigger
                      aria-controls="picker-sort-direction-content"
                      className="h-9 w-full rounded-lg border-slate-300/80 bg-white shadow-sm sm:w-34"
                    >
                      <SelectValue placeholder="Direction" />
                    </SelectTrigger>
                    <SelectContent id="picker-sort-direction-content">
                      <SelectItem value="asc">
                        <div className="flex items-center gap-2">
                          <ArrowDownAZIcon className="size-4" />
                          Asc
                        </div>
                      </SelectItem>
                      <SelectItem value="desc">
                        <div className="flex items-center gap-2">
                          <ArrowUpZAIcon className="size-4" />
                          Desc
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    variant="outline"
                    className="h-9 rounded-lg border-slate-300/80 bg-white text-slate-700 shadow-sm"
                    onClick={handleResetControls}
                    disabled={!hasActiveControls}
                  >
                    Reset
                  </Button>
                </div>
              ) : (
                <div className="h-9 sm:w-60" aria-hidden="true" />
              )}
            </div>

            <div className="space-y-3 lg:hidden">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
                <Input
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Search files and folders"
                  suppressHydrationWarning
                  className="h-10 rounded-xl border-slate-300/80 bg-white pl-9 shadow-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="h-10 justify-start rounded-xl border-slate-300/80 bg-white text-slate-700 shadow-sm"
                  onClick={() => setIsMobileFoldersOpen(true)}
                >
                  <PanelLeftOpenIcon className="size-4" />
                  Browse folders
                </Button>
                <Button
                  variant="outline"
                  className="h-10 justify-start rounded-xl border-slate-300/80 bg-white text-slate-700 shadow-sm"
                  onClick={() => setIsMobileFiltersOpen(true)}
                >
                  <SlidersHorizontalIcon className="size-4" />
                  Filters
                </Button>
              </div>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="hidden min-h-0 overflow-hidden border-b border-slate-300/80 bg-[#eef1f6] lg:block lg:border-b-0 lg:border-r">
              <FolderTree />
            </aside>
            <main className="flex min-h-0 flex-col bg-white/70">
              {knowledgeBaseBinding && bindingToneConfig ? (
                <div
                  className={`border-b px-4 py-2 text-sm ${bindingToneConfig.border} ${bindingToneConfig.background} ${bindingToneConfig.text}`}
                >
                  <div className="flex items-start gap-2">
                    {BindingIcon ? (
                      <BindingIcon className="mt-0.5 size-4 shrink-0" />
                    ) : null}
                    <p>
                      {knowledgeBaseBinding.message ??
                        "Knowledge base binding needs attention before indexing actions can run."}
                    </p>
                  </div>
                </div>
              ) : null}
              {isStatusOverlayError ? (
                <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-2">
                      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                      <p>{statusOverlayErrorMessage}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                      onClick={() => {
                        void refetchFolderStatuses()
                      }}
                    >
                      Retry status
                    </Button>
                  </div>
                </div>
              ) : null}
              <div className="flex items-center justify-between border-b border-slate-300/70 bg-white/80 px-4 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-slate-700">
                    {isSearchMode ? "Search results" : selectedFolderName}
                  </p>
                  {isSearchMode ? (
                    <p className="text-[11px] text-slate-500">
                      Across the entire Google Drive connection
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-500 lg:hidden">
                      {selectedFolderPath}
                    </p>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  {hasMoreInSource ? `${visibleItems.length} loaded` : `${visibleItems.length} shown`}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <FileList
                  items={visibleItems}
                  folderName={selectedFolderName}
                  hasMore={hasMoreInSource}
                  isPending={folderQuery.isPending}
                  isError={folderQuery.isError}
                  errorMessage={folderQuery.isError ? folderQuery.error?.message : undefined}
                  pendingActionsByItemId={itemActionMutation.pendingActionsByItemId}
                  isFetchingNextPage={folderQuery.isFetchingNextPage}
                  isSearchMode={isSearchMode}
                  showPath={isSearchMode}
                  onLoadMore={handleLoadMore}
                  onOpenFolder={handleOpenFolder}
                  onPrefetchFolder={handlePrefetchFolder}
                  onAction={handleAction}
                />
              </div>
            </main>
          </div>
        </section>
      </div>

      <Dialog open={isMobileFoldersOpen} onOpenChange={setIsMobileFoldersOpen}>
        <DialogContent className="max-w-[calc(100%-1rem)] rounded-[28px] border-slate-200 bg-white p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-slate-200 px-4 py-4">
            <DialogTitle className="text-base text-slate-900">Browse folders</DialogTitle>
            <DialogDescription>
              Choose a folder from the Drive tree and return to the file list.
            </DialogDescription>
          </DialogHeader>
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-medium text-slate-500">
            Folders only
          </div>
          <div className="h-[min(75vh,36rem)] max-h-[95%] overflow-hidden bg-white" style={{marginBottom: 4}}>
            <FolderTree showFiles={false} showHeader={false} variant="mobile" />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isMobileFiltersOpen} onOpenChange={setIsMobileFiltersOpen}>
        <DialogContent className="max-w-[calc(100%-1rem)] rounded-[28px] border-slate-200 p-0 sm:max-w-sm">
          <DialogHeader className="border-b border-slate-200 px-4 py-4">
            <DialogTitle className="text-base text-slate-900">Filters</DialogTitle>
            <DialogDescription>
              Refine what you see in the current file list.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-4 py-4">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                Type
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  size="sm"
                  variant={controls.typeFilter === "all" ? "default" : "outline"}
                  className="h-9 rounded-full text-xs"
                  onClick={() => setControl("type", "all")}
                >
                  All
                </Button>
                <Button
                  size="sm"
                  variant={controls.typeFilter === "file" ? "default" : "outline"}
                  className="h-9 rounded-full text-xs"
                  onClick={() => setControl("type", "file")}
                >
                  Files
                </Button>
                <Button
                  size="sm"
                  variant={controls.typeFilter === "folder" ? "default" : "outline"}
                  className="h-9 rounded-full text-xs"
                  onClick={() => setControl("type", "folder")}
                >
                  Folders
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  Sort
                </p>
                <div className="grid grid-cols-1 gap-2">
                  <Button
                    size="sm"
                    variant={controls.sortBy === "name" ? "default" : "outline"}
                    className="h-9 rounded-full text-xs"
                    onClick={() => setControl("sort", "name")}
                  >
                    Name
                  </Button>
                  <Button
                    size="sm"
                    variant={controls.sortBy === "date" ? "default" : "outline"}
                    className="h-9 rounded-full text-xs"
                    onClick={() => setControl("sort", "date")}
                  >
                    Date
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  Direction
                </p>
                <div className="grid grid-cols-1 gap-2">
                  <Button
                    size="sm"
                    variant={controls.sortDirection === "asc" ? "default" : "outline"}
                    className="h-9 rounded-full text-xs"
                    onClick={() => setControl("dir", "asc")}
                  >
                    Asc
                  </Button>
                  <Button
                    size="sm"
                    variant={controls.sortDirection === "desc" ? "default" : "outline"}
                    className="h-9 rounded-full text-xs"
                    onClick={() => setControl("dir", "desc")}
                  >
                    Desc
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <p className="text-[11px] text-slate-500">
              {hasActiveControls ? "Filters active" : "Default order"}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-3 text-xs text-slate-600"
              onClick={handleResetControls}
              disabled={!hasActiveControls}
            >
              Reset
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}
