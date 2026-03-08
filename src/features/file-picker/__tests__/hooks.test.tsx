// @vitest-environment jsdom

import * as React from "react"
import { QueryClientProvider, type InfiniteData } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  mergeItemsWithStatuses,
  useItemActionMutation,
} from "@/features/file-picker/hooks"
import {
  folderChildrenKey,
  folderStatusKey,
} from "@/features/file-picker/query-keys"
import { makeQueryClient } from "@/lib/query-client"
import type {
  FolderItemsResponse,
  StatusOverlayResponse,
  StatusAwareDriveItem,
} from "@/lib/drive-types"

const executeItemActionMock = vi.hoisted(() => vi.fn())
const toastErrorMock = vi.hoisted(() => vi.fn())
const toastSuccessMock = vi.hoisted(() => vi.fn())
const toastInfoMock = vi.hoisted(() => vi.fn())

vi.mock("@/features/file-picker/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/file-picker/api")>()
  return {
    ...actual,
    executeItemAction: executeItemActionMock,
  }
})

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
    info: toastInfoMock,
  },
}))

function deferredPromise<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

describe("useItemActionMutation", () => {
  beforeEach(() => {
    executeItemActionMock.mockReset()
    toastErrorMock.mockReset()
    toastSuccessMock.mockReset()
    toastInfoMock.mockReset()
  })

  it("rolls back an optimistic unlist when the server action fails", async () => {
    const queryClient = makeQueryClient()
    const deferred = deferredPromise<{ action: "unlist"; affectedIds: string[] }>()

    executeItemActionMock.mockReturnValue(deferred.promise)

    const queryKey = folderChildrenKey({
      parentId: "root",
      parentPath: "/",
      pageSize: 100,
    })
    const statusKey = folderStatusKey({
      mode: "browse",
      parentPath: "/",
      itemIds: ["file-a"],
    })

    queryClient.setQueryData<InfiniteData<FolderItemsResponse, string | null>>(queryKey, {
      pages: [
        {
          parentId: "root",
          connectionId: "conn-1",
          hasMore: false,
          nextCursor: null,
          items: [
            {
              id: "file-a",
              name: "a.txt",
              type: "file",
              parentId: "root",
              resourcePath: "/a.txt",
              modifiedAt: "2026-01-01T10:00:00.000Z",
              indexState: "unknown",
              indexOrigin: "unknown",
            },
          ],
        },
      ],
      pageParams: [null],
    })
    queryClient.setQueryData<StatusOverlayResponse>(statusKey, {
      knowledgeBaseBinding: {
        state: "ready",
        knowledgeBaseId: "kb-1",
      },
      itemsById: {
        "file-a": {
          indexOrigin: "none",
          indexState: "not_indexed",
          isHidden: false,
          displayStatus: {
            code: "not_in_kb",
            label: "Not in KB",
            tone: "neutral",
            kind: "source-membership",
          },
          capabilities: {
            index: { allowed: true },
            deindex: {
              allowed: false,
              reasonCode: "not_indexed",
              reasonMessage: "This item is not indexed directly.",
            },
            unlist: { allowed: true },
            restore: {
              allowed: false,
              reasonCode: "not_hidden",
              reasonMessage: "This item is not hidden.",
            },
          },
        },
      },
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")
    const { result } = renderHook(
      () =>
        useItemActionMutation({
          activeListQueryKey: queryKey,
          activeStatusQueryKey: statusKey,
        }),
      {
        wrapper,
      },
    )

    act(() => {
      result.current.mutate({
        itemId: "file-a",
        action: "unlist",
        itemType: "file",
        resourcePath: "/a.txt",
        parentId: "root",
        item: {
          id: "file-a",
          name: "a.txt",
          type: "file",
          parentId: "root",
          resourcePath: "/a.txt",
          modifiedAt: "2026-01-01T10:00:00.000Z",
          indexState: "not_indexed",
          indexOrigin: "none",
          isHidden: false,
          displayStatus: {
            code: "not_in_kb",
            label: "Not in KB",
            tone: "neutral",
            kind: "source-membership",
          },
          capabilities: {
            index: { allowed: true },
            deindex: {
              allowed: false,
              reasonCode: "not_indexed",
              reasonMessage: "This item is not indexed directly.",
            },
            unlist: { allowed: true },
            restore: {
              allowed: false,
              reasonCode: "not_hidden",
              reasonMessage: "This item is not hidden.",
            },
          },
        },
      })
    })

    await waitFor(() => {
      const currentData = queryClient.getQueryData<
        InfiniteData<FolderItemsResponse, string | null>
      >(queryKey)

      expect(currentData?.pages[0]?.items).toHaveLength(0)
      expect(queryClient.getQueryData(statusKey)).toMatchObject({
        itemsById: {
          "file-a": {
            indexState: "not_indexed",
            displayStatus: {
              code: "not_in_kb",
              label: "Not in KB",
              tone: "neutral",
              kind: "source-membership",
            },
          },
        },
      })
    })

    await act(async () => {
      deferred.reject(new Error("partial failure"))
    })

    await waitFor(() => {
      const restoredData = queryClient.getQueryData<
        InfiniteData<FolderItemsResponse, string | null>
      >(queryKey)

      expect(restoredData?.pages[0]?.items).toHaveLength(1)
      expect(toastErrorMock).toHaveBeenCalledWith("partial failure")
      expect(invalidateSpy).toHaveBeenCalledWith({
        exact: true,
        queryKey,
      })
      expect(invalidateSpy).toHaveBeenCalledWith({
        exact: true,
        queryKey: statusKey,
      })
    })
  })

  it("keeps a transient deindex state active until the server-confirmed transition is cleared", async () => {
    const queryClient = makeQueryClient()

    executeItemActionMock.mockResolvedValue({
      action: "deindex",
      affectedIds: ["file-a"],
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const item: StatusAwareDriveItem = {
      id: "file-a",
      name: "a.txt",
      type: "file",
      parentId: "root",
      resourcePath: "/a.txt",
      modifiedAt: "2026-01-01T10:00:00.000Z",
      indexState: "indexed",
      indexOrigin: "direct",
      isHidden: false,
      displayStatus: {
        code: "indexed",
        label: "Indexed",
        tone: "success",
        kind: "materialization",
      },
      capabilities: {
        index: {
          allowed: false,
          reasonCode: "already_indexed_direct",
          reasonMessage: "This item is already indexed directly.",
        },
        deindex: { allowed: true },
        unlist: { allowed: true },
        restore: {
          allowed: false,
          reasonCode: "not_hidden",
          reasonMessage: "This item is not hidden.",
        },
      },
    }

    const { result } = renderHook(() => useItemActionMutation(), {
      wrapper,
    })

    act(() => {
      result.current.mutate({
        itemId: item.id,
        action: "deindex",
        itemType: item.type,
        resourcePath: item.resourcePath!,
        parentId: "root",
        item,
      })
    })

    await waitFor(() => {
      expect(result.current.pendingActionsByItemId["file-a"]).toBe("deindex")
      expect(result.current.transientStatusesByItemId["file-a"]).toMatchObject({
        indexState: "deindexing",
        displayStatus: {
          code: "removing",
          label: "Removing from KB",
        },
      })
    })

    act(() => {
      result.current.clearCompletedTransition("file-a")
    })

    await waitFor(() => {
      expect(result.current.pendingActionsByItemId["file-a"]).toBeUndefined()
      expect(result.current.transientStatusesByItemId["file-a"]).toBeUndefined()
    })
  })

  it("invalidates only the active status query after deindex", async () => {
    const queryClient = makeQueryClient()
    const listKey = folderChildrenKey({
      parentId: "root",
      parentPath: "/",
      pageSize: 100,
    })
    const statusKey = folderStatusKey({
      mode: "browse",
      parentPath: "/",
      itemIds: ["file-a"],
    })

    executeItemActionMock.mockResolvedValue({
      action: "deindex",
      affectedIds: ["file-a"],
    })

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")
    const { result } = renderHook(
      () =>
        useItemActionMutation({
          activeListQueryKey: listKey,
          activeStatusQueryKey: statusKey,
        }),
      {
        wrapper,
      },
    )

    const item: StatusAwareDriveItem = {
      id: "file-a",
      name: "a.txt",
      type: "file",
      parentId: "root",
      resourcePath: "/a.txt",
      modifiedAt: "2026-01-01T10:00:00.000Z",
      indexState: "indexed",
      indexOrigin: "direct",
      isHidden: false,
      displayStatus: {
        code: "in_kb",
        label: "In KB",
        tone: "success",
        kind: "materialization",
      },
      capabilities: {
        index: {
          allowed: false,
          reasonCode: "already_indexed_direct",
          reasonMessage: "This item is already indexed directly.",
        },
        deindex: { allowed: true },
        unlist: { allowed: true },
        restore: {
          allowed: false,
          reasonCode: "not_hidden",
          reasonMessage: "This item is not hidden.",
        },
      },
    }

    act(() => {
      result.current.mutate({
        itemId: item.id,
        action: "deindex",
        itemType: item.type,
        resourcePath: item.resourcePath!,
        parentId: "root",
        item,
      })
    })

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalled()
      expect(invalidateSpy).toHaveBeenCalledWith({
        exact: true,
        queryKey: statusKey,
      })
      expect(invalidateSpy).not.toHaveBeenCalledWith({
        exact: true,
        queryKey: listKey,
      })
    })
  })

  it("lets transient statuses override stale server overlay badges", () => {
    const merged = mergeItemsWithStatuses(
      [
        {
          id: "folder-a",
          name: "Books",
          type: "folder",
          parentId: "root",
          resourcePath: "/books",
          modifiedAt: "2026-01-01T10:00:00.000Z",
          indexState: "unknown",
          indexOrigin: "unknown",
        },
      ],
      {
        knowledgeBaseBinding: {
          state: "ready",
          knowledgeBaseId: "kb-1",
        },
        itemsById: {
          "folder-a": {
            indexOrigin: "direct",
            indexState: "unknown",
            isHidden: false,
            displayStatus: {
              code: "added_to_kb",
              label: "Added to KB",
              tone: "success",
              kind: "source-membership",
            },
            capabilities: {
              index: {
                allowed: false,
                reasonCode: "already_indexed_direct",
                reasonMessage: "This item is already indexed directly.",
              },
              deindex: { allowed: true },
              unlist: {
                allowed: false,
                reasonCode: "unsupported_item_type",
                reasonMessage: "Only files can be removed from listing.",
              },
              restore: {
                allowed: false,
                reasonCode: "not_hidden",
                reasonMessage: "This item is not hidden.",
              },
            },
          },
        },
      },
      {
        "folder-a": {
          indexState: "deindexing",
          displayStatus: {
            code: "deindexing",
            label: "Removing from KB",
            tone: "warning",
            kind: "materialization",
          },
        },
      },
    )

    expect(merged[0]).toMatchObject({
      indexState: "deindexing",
      displayStatus: {
        code: "deindexing",
        label: "Removing from KB",
      },
    })
  })
})
