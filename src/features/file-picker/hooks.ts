"use client"

import * as React from "react"
import {
  InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { toast } from "sonner"

import {
  executeItemAction,
  fetchFolderItems,
  fetchFolderItemStatuses,
} from "@/features/file-picker/api"
import {
  folderChildrenKey,
  folderStatusKey,
} from "@/features/file-picker/query-keys"
import type {
  DisplayStatus,
  DriveItem,
  DriveItemCapabilities,
  FolderItemsResponse,
  IndexState,
  ItemAction,
  ItemActionPayload,
  KnowledgeBaseBinding,
  StatusAwareDriveItem,
  StatusOverlayResponse,
} from "@/lib/drive-types"

const FOLDER_QUERY_STALE_TIME_MS = 60_000
const FOLDER_QUERY_GC_TIME_MS = 10 * 60_000
const LIVE_STATUS_REFETCH_INTERVAL_MS = 2_500
export const FORCED_STATUS_REFETCH_INTERVAL_MS = 1_500
const TRANSITION_TIMEOUT_MS = 20_000
const DEFAULT_FOLDER_PAGE_SIZE = 100
const EMPTY_PAGES: readonly FolderItemsResponse[] = []

interface FolderItemsOptions {
  enabled?: boolean
  parentPath?: string
  pageSize?: number
  query?: string
  includeHidden?: boolean
}

interface UseFolderItemsResult {
  data: FolderItemsResponse | undefined
  rawItems: readonly DriveItem[]
  connectionId: string | undefined
  isPending: boolean
  isError: boolean
  error: Error | null
  hasMore: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => Promise<unknown>
  refetch: () => Promise<unknown>
}

interface FolderStatusOptions {
  enabled?: boolean
  mode: "browse" | "search"
  parentPath?: string
  query?: string
  items: readonly DriveItem[]
}

interface UseFolderStatusesResult {
  data: StatusOverlayResponse | undefined
  knowledgeBaseBinding: KnowledgeBaseBinding | undefined
  isPending: boolean
  isError: boolean
  error: Error | null
  refetch: () => Promise<unknown>
}

interface ItemActionVariables extends ItemActionPayload {
  parentId: string
  item: StatusAwareDriveItem
}

interface QueryItemSnapshot {
  key: readonly unknown[]
  pages: FolderItemsResponse[]
}

interface ItemActionContext {
  snapshots: QueryItemSnapshot[]
}

interface TransientStatusOverride {
  indexState: IndexState
  displayStatus: DisplayStatus
}

interface ActiveTransition {
  action: ItemAction
  itemType: DriveItem["type"]
}

interface UseItemActionMutationOptions {
  activeListQueryKey?: readonly unknown[]
  activeStatusQueryKey?: readonly unknown[]
}

const DEFAULT_STATUS_LOADING_CAPABILITIES: DriveItemCapabilities = {
  index: disabledCapability("Status overlay is still loading."),
  deindex: disabledCapability("Status overlay is still loading."),
  unlist: disabledCapability("Status overlay is still loading."),
  restore: {
    allowed: false,
    reasonCode: "not_hidden",
    reasonMessage: "This item is not hidden.",
  },
}

const DEFAULT_HIDDEN_CAPABILITIES: DriveItemCapabilities = {
  index: {
    allowed: false,
    reasonCode: "hidden_item",
    reasonMessage: "Hidden items must be restored before indexing.",
  },
  deindex: {
    allowed: false,
    reasonCode: "hidden_item",
    reasonMessage: "Hidden items must be restored before de-indexing.",
  },
  unlist: {
    allowed: false,
    reasonCode: "hidden_item",
    reasonMessage: "This item is already hidden.",
  },
  restore: {
    allowed: true,
  },
}

function hasLiveStatuses(data: StatusOverlayResponse | undefined): boolean {
  if (!data) {
    return false
  }

  return Object.values(data.itemsById).some(
    (item) => item.indexState === "pending" || item.indexState === "deindexing",
  )
}

function createFolderItemsQueryFn(args: {
  folderId: string
  parentPath?: string
  pageSize: number
  query?: string
  includeHidden?: boolean
}) {
  return ({
    pageParam,
    signal,
  }: {
    pageParam: string | null
    signal: AbortSignal
  }) =>
    fetchFolderItems(
      {
        parentId: args.folderId,
        parentPath: args.parentPath,
        pageSize: args.pageSize,
        query: args.query,
        includeHidden: args.includeHidden,
        cursor: pageParam ?? undefined,
      },
      signal,
    )
}

function flattenPages(pages: readonly FolderItemsResponse[]): DriveItem[] {
  return pages.flatMap((page) => page.items)
}

function disabledCapability(reasonMessage: string): DriveItemCapabilities[keyof DriveItemCapabilities] {
  return {
    allowed: false,
    reasonCode: "unknown_status",
    reasonMessage,
  }
}

function defaultCapabilities(item: DriveItem): DriveItemCapabilities {
  if (item.isHidden) {
    return DEFAULT_HIDDEN_CAPABILITIES
  }

  return DEFAULT_STATUS_LOADING_CAPABILITIES
}

function mergeStatusAwareItem(
  item: DriveItem,
  overlay: StatusOverlayResponse | undefined,
  transientStatusesByItemId: Readonly<Record<string, TransientStatusOverride>> | undefined,
): StatusAwareDriveItem {
  const status = overlay?.itemsById[item.id]
  const transient = transientStatusesByItemId?.[item.id]

  return {
    ...item,
    presentInKb: status?.presentInKb,
    indexState: transient?.indexState ?? status?.indexState ?? item.indexState,
    indexOrigin: status?.indexOrigin ?? item.indexOrigin,
    isHidden: status?.isHidden ?? item.isHidden,
    displayStatus: transient?.displayStatus ?? status?.displayStatus,
    capabilities: status?.capabilities ?? defaultCapabilities(item),
  }
}

export function mergeItemsWithStatuses(
  items: readonly DriveItem[],
  overlay: StatusOverlayResponse | undefined,
  transientStatusesByItemId?: Readonly<Record<string, TransientStatusOverride>>,
): StatusAwareDriveItem[] {
  return items.map((item) =>
    mergeStatusAwareItem(item, overlay, transientStatusesByItemId),
  )
}

export function useFolderItems(
  folderId: string,
  options?: FolderItemsOptions,
): UseFolderItemsResult {
  const pageSize = options?.pageSize ?? DEFAULT_FOLDER_PAGE_SIZE
  const normalizedQuery = options?.query?.trim() || undefined

  const query = useInfiniteQuery({
    queryKey: folderChildrenKey({
      parentId: folderId,
      parentPath: options?.parentPath,
      query: normalizedQuery,
      pageSize,
      includeHidden: options?.includeHidden,
    }),
    queryFn: createFolderItemsQueryFn({
      folderId,
      parentPath: options?.parentPath,
      pageSize,
      query: normalizedQuery,
      includeHidden: options?.includeHidden,
    }),
    enabled: options?.enabled ?? true,
    staleTime: FOLDER_QUERY_STALE_TIME_MS,
    gcTime: FOLDER_QUERY_GC_TIME_MS,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const pages = query.data?.pages ?? EMPTY_PAGES
  const rawItems = React.useMemo(() => flattenPages(pages), [pages])
  const connectionId = pages[0]?.connectionId

  const aggregatedData = React.useMemo<FolderItemsResponse | undefined>(() => {
    const firstPage = pages[0]
    if (!firstPage) {
      return undefined
    }

    return {
      parentId: firstPage.parentId,
      connectionId: firstPage.connectionId,
      items: rawItems,
      hasMore: Boolean(query.hasNextPage),
      nextCursor: pages[pages.length - 1]?.nextCursor ?? null,
    }
  }, [pages, query.hasNextPage, rawItems])

  return {
    data: aggregatedData,
    rawItems,
    connectionId,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error as Error | null,
    hasMore: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  }
}

export function useFolderItemStatuses(
  options: FolderStatusOptions,
): UseFolderStatusesResult {
  const requestItems = React.useMemo(
    () =>
      options.items
        .filter((item) => Boolean(item.resourcePath))
        .map((item) => ({
          id: item.id,
          resourcePath: item.resourcePath ?? "/",
          type: item.type,
        })),
    [options.items],
  )

  const query = useQuery({
    queryKey: folderStatusKey({
      mode: options.mode,
      parentPath: options.parentPath,
      query: options.query,
      itemIds: requestItems.map((item) => item.id),
    }),
    queryFn: () =>
      fetchFolderItemStatuses({
        mode: options.mode,
        parentPath: options.parentPath,
        query: options.query,
        items: requestItems,
      }),
    enabled: (options.enabled ?? true) && requestItems.length > 0,
    staleTime: 5_000,
    gcTime: FOLDER_QUERY_GC_TIME_MS,
    refetchInterval: (state) =>
      hasLiveStatuses(state.state.data) ? LIVE_STATUS_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  })

  return {
    data: query.data,
    knowledgeBaseBinding: query.data?.knowledgeBaseBinding,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
  }
}

export function usePrefetchFolderItems(): (folderId: string, parentPath?: string) => Promise<void> {
  const queryClient = useQueryClient()

  return React.useCallback(
    async (folderId: string, parentPath?: string) => {
      await queryClient.prefetchInfiniteQuery({
        queryKey: folderChildrenKey({
          parentId: folderId,
          parentPath,
          pageSize: DEFAULT_FOLDER_PAGE_SIZE,
        }),
        queryFn: createFolderItemsQueryFn({
          folderId,
          parentPath,
          pageSize: DEFAULT_FOLDER_PAGE_SIZE,
        }),
        initialPageParam: null as string | null,
        staleTime: FOLDER_QUERY_STALE_TIME_MS,
      })
    },
    [queryClient],
  )
}

function successMessage(action: ItemAction): string {
  if (action === "index") {
    return "Added to the knowledge base. Sync will update statuses shortly."
  }
  if (action === "deindex") {
    return "Removed from the knowledge base."
  }
  if (action === "restore") {
    return "Item restored to listing."
  }
  return "Item removed from the knowledge base if needed and hidden from listing."
}

function isKnowledgeBaseManagedItem(item: StatusAwareDriveItem): boolean {
  return (
    Boolean(item.presentInKb) ||
    item.capabilities.deindex.allowed ||
    item.displayStatus?.code === "in_kb" ||
    item.displayStatus?.code === "syncing" ||
    item.displayStatus?.code === "removing" ||
    item.displayStatus?.code === "error"
  )
}

function shouldTrackTransition(item: StatusAwareDriveItem, action: ItemAction): boolean {
  if (action === "index" || action === "deindex" || action === "restore") {
    return true
  }

  if (action === "unlist") {
    return isKnowledgeBaseManagedItem(item)
  }

  return false
}

function shouldOptimisticallyHideItem(
  item: StatusAwareDriveItem,
  action: ItemAction,
): boolean {
  return action === "unlist" && !shouldTrackTransition(item, action)
}

function buildTransientStatus(
  action: ItemAction,
): TransientStatusOverride {
  if (action === "index") {
    return {
      indexState: "pending",
      displayStatus: {
        code: "syncing",
        label: "Syncing",
        tone: "warning",
        kind: "materialization",
        tooltip: "Stack AI is applying this index change.",
      },
    }
  }

  if (action === "restore") {
    return {
      indexState: "unknown",
      displayStatus: {
        code: "syncing",
        label: "Restoring",
        tone: "info",
        kind: "binding",
        tooltip: "Refreshing item visibility.",
      },
    }
  }

  return {
    indexState: "deindexing",
    displayStatus: {
      code: "removing",
      label: "Removing from KB",
      tone: "warning",
      kind: "materialization",
      tooltip: "Stack AI is applying this removal.",
    },
  }
}

function snapshotActiveFolderQuery(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey?: readonly unknown[],
): QueryItemSnapshot[] {
  if (!queryKey) {
    return []
  }

  const data =
    queryClient.getQueryData<InfiniteData<FolderItemsResponse, string | null>>(queryKey)

  if (!isFolderItemsInfiniteData(data) || !isFolderItemsQueryKey(queryKey)) {
    return []
  }

  return [
    {
      key: queryKey,
      pages: data.pages,
    },
  ]
}

function isFolderItemsQueryKey(key: readonly unknown[]): boolean {
  return key[0] === "files" && (key[1] === "folder" || key[1] === "search")
}

function isFolderItemsInfiniteData(
  data: unknown,
): data is InfiniteData<FolderItemsResponse, string | null> {
  if (typeof data !== "object" || data === null || !("pages" in data)) {
    return false
  }

  const pages = (data as { pages?: unknown }).pages
  return Array.isArray(pages)
}

function optimisticallyHideItemInActiveQuery(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: readonly unknown[] | undefined,
  itemId: string,
): void {
  if (!queryKey) {
    return
  }

  const data =
    queryClient.getQueryData<InfiniteData<FolderItemsResponse, string | null>>(queryKey)

  if (!isFolderItemsInfiniteData(data) || !isFolderItemsQueryKey(queryKey)) {
    return
  }

  queryClient.setQueryData<InfiniteData<FolderItemsResponse, string | null>>(queryKey, {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((item) => item.id !== itemId),
    })),
  })
}

function actionChangesListMembership(action: ItemAction): boolean {
  return action === "unlist" || action === "restore"
}

async function invalidateCurrentViewQueries(args: {
  queryClient: ReturnType<typeof useQueryClient>
  action: ItemAction
  activeListQueryKey?: readonly unknown[]
  activeStatusQueryKey?: readonly unknown[]
}): Promise<void> {
  const tasks: Promise<unknown>[] = []

  if (args.activeStatusQueryKey) {
    tasks.push(
      args.queryClient.invalidateQueries({
        queryKey: args.activeStatusQueryKey,
        exact: true,
      }),
    )
  }

  if (actionChangesListMembership(args.action) && args.activeListQueryKey) {
    tasks.push(
      args.queryClient.invalidateQueries({
        queryKey: args.activeListQueryKey,
        exact: true,
      }),
    )
  }

  await Promise.all(tasks)
}

export function useItemActionMutation(options?: UseItemActionMutationOptions) {
  const queryClient = useQueryClient()
  const [pendingActionsByItemId, setPendingActionsByItemId] = React.useState<
    Record<string, ItemAction>
  >({})
  const [transientStatusesByItemId, setTransientStatusesByItemId] = React.useState<
    Record<string, TransientStatusOverride>
  >({})
  const [activeTransitionsByItemId, setActiveTransitionsByItemId] = React.useState<
    Record<string, ActiveTransition>
  >({})
  const timeoutHandlesRef = React.useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({})

  const clearTransitionState = React.useCallback((itemId: string) => {
    const timeoutHandle = timeoutHandlesRef.current[itemId]
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
      delete timeoutHandlesRef.current[itemId]
    }

    setPendingActionsByItemId((current) => {
      if (!(itemId in current)) {
        return current
      }

      const next = { ...current }
      delete next[itemId]
      return next
    })
    setTransientStatusesByItemId((current) => {
      if (!(itemId in current)) {
        return current
      }

      const next = { ...current }
      delete next[itemId]
      return next
    })
    setActiveTransitionsByItemId((current) => {
      if (!(itemId in current)) {
        return current
      }

      const next = { ...current }
      delete next[itemId]
      return next
    })
  }, [])

  const expireTransition = React.useCallback(
    (itemId: string, action: ItemAction) => {
      clearTransitionState(itemId)
      void invalidateCurrentViewQueries({
        queryClient,
        action,
        activeListQueryKey: options?.activeListQueryKey,
        activeStatusQueryKey: options?.activeStatusQueryKey,
      })
      toast.info("Stack AI is still syncing; status may update shortly.")
    },
    [
      clearTransitionState,
      options?.activeListQueryKey,
      options?.activeStatusQueryKey,
      queryClient,
    ],
  )

  const startTransition = React.useCallback(
    (item: StatusAwareDriveItem, action: ItemAction) => {
      const timeoutHandle = timeoutHandlesRef.current[item.id]
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }

      timeoutHandlesRef.current[item.id] = setTimeout(() => {
        expireTransition(item.id, action)
      }, TRANSITION_TIMEOUT_MS)

      setTransientStatusesByItemId((current) => ({
        ...current,
        [item.id]: buildTransientStatus(action),
      }))
      setActiveTransitionsByItemId((current) => ({
        ...current,
        [item.id]: {
          action,
          itemType: item.type,
        },
      }))
    },
    [expireTransition],
  )

  React.useEffect(() => {
    return () => {
      for (const timeoutHandle of Object.values(timeoutHandlesRef.current)) {
        clearTimeout(timeoutHandle)
      }
      timeoutHandlesRef.current = {}
    }
  }, [])

  const mutation = useMutation({
    mutationFn: async (variables: ItemActionVariables) =>
      executeItemAction({
        itemId: variables.itemId,
        action: variables.action,
        itemType: variables.itemType,
        resourcePath: variables.resourcePath,
      }),
    onMutate: async (variables): Promise<ItemActionContext> => {
      await Promise.all([
        options?.activeListQueryKey
          ? queryClient.cancelQueries({
              queryKey: options.activeListQueryKey,
              exact: true,
            })
          : Promise.resolve(),
        options?.activeStatusQueryKey
          ? queryClient.cancelQueries({
              queryKey: options.activeStatusQueryKey,
              exact: true,
            })
          : Promise.resolve(),
      ])
      setPendingActionsByItemId((current) => ({
        ...current,
        [variables.itemId]: variables.action,
      }))

      if (shouldTrackTransition(variables.item, variables.action)) {
        startTransition(variables.item, variables.action)
      }

      const snapshots = snapshotActiveFolderQuery(
        queryClient,
        options?.activeListQueryKey,
      )

      if (shouldOptimisticallyHideItem(variables.item, variables.action)) {
        optimisticallyHideItemInActiveQuery(
          queryClient,
          options?.activeListQueryKey,
          variables.itemId,
        )
      }

      return { snapshots }
    },
    onError: (error, variables, context) => {
      for (const snapshot of context?.snapshots ?? []) {
        queryClient.setQueryData<InfiniteData<FolderItemsResponse, string | null>>(
          snapshot.key,
          (current) =>
            current
              ? {
                  ...current,
                  pages: snapshot.pages,
                }
              : current,
        )
      }

      toast.error(
        error instanceof Error ? error.message : "Action failed unexpectedly.",
      )
      clearTransitionState(variables.itemId)
    },
    onSuccess: (_response, variables) => {
      toast.success(successMessage(variables.action))
    },
    onSettled: async (_data, error, variables) => {
      if (error || !shouldTrackTransition(variables.item, variables.action)) {
        clearTransitionState(variables.itemId)
      }
      // Keep refetch scoped to the active list/status view so async StackAI sync
      // confirmation does not churn unrelated cached folders or searches.
      await invalidateCurrentViewQueries({
        queryClient,
        action: variables.action,
        activeListQueryKey: options?.activeListQueryKey,
        activeStatusQueryKey: options?.activeStatusQueryKey,
      })
    },
  })

  return {
    ...mutation,
    pendingActionsByItemId,
    transientStatusesByItemId,
    activeTransitionsByItemId,
    clearCompletedTransition: clearTransitionState,
  }
}
