// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { FolderTree } from "@/features/file-picker/components/folder-tree"
import { ROOT_FOLDER_ID, type DriveItem } from "@/lib/drive-types"
import { useFilePickerStore } from "@/features/file-picker/store"

const useFolderItemsMock = vi.hoisted(() => vi.fn())
const usePrefetchFolderItemsMock = vi.hoisted(() => vi.fn())

vi.mock("@/features/file-picker/hooks", () => ({
  useFolderItems: useFolderItemsMock,
  usePrefetchFolderItems: usePrefetchFolderItemsMock,
}))

function createItem(overrides: Partial<DriveItem>): DriveItem {
  return {
    id: overrides.id ?? "item-1",
    name: overrides.name ?? "Item",
    type: overrides.type ?? "file",
    parentId: overrides.parentId ?? ROOT_FOLDER_ID,
    resourcePath: overrides.resourcePath ?? "/item",
    modifiedAt: overrides.modifiedAt ?? "2026-01-01T10:00:00.000Z",
    indexState: overrides.indexState ?? "not_indexed",
    indexOrigin:
      overrides.indexOrigin ??
      ((overrides.indexState ?? "not_indexed") === "indexed" ? "direct" : "none"),
    sizeBytes: overrides.sizeBytes,
    mimeType: overrides.mimeType,
  }
}

function queryState(
  items: readonly DriveItem[],
  options?: {
    isPending?: boolean
    isError?: boolean
    error?: Error
  },
) {
  return {
    data: {
      parentId: ROOT_FOLDER_ID,
      connectionId: "conn-1",
      items,
      hasMore: false,
      nextCursor: null,
    },
    isPending: options?.isPending ?? false,
    isError: options?.isError ?? false,
    error: options?.error ?? null,
    hasMore: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }
}

describe("FolderTree", () => {
  beforeEach(() => {
    useFilePickerStore.setState({
      selectedFolderId: ROOT_FOLDER_ID,
      selectedFolderName: "My Drive",
      selectedFolderPath: "/",
      expandedFolderIds: [ROOT_FOLDER_ID],
    })
    useFolderItemsMock.mockReset()
    usePrefetchFolderItemsMock.mockReset()
  })

  it("shows files when expanded folder has no subfolders", () => {
    const folder = createItem({
      id: "folder-1",
      name: "books",
      type: "folder",
      resourcePath: "/books",
    })
    const fileInFolder = createItem({
      id: "file-1",
      name: "chapter1.txt",
      type: "file",
      parentId: "folder-1",
      resourcePath: "/books/chapter1.txt",
    })

    useFilePickerStore.setState({
      selectedFolderId: "folder-1",
      selectedFolderName: "books",
      selectedFolderPath: "/books",
      expandedFolderIds: [ROOT_FOLDER_ID, "folder-1"],
    })

    useFolderItemsMock.mockImplementation((folderId: string) => {
      if (folderId === ROOT_FOLDER_ID) {
        return queryState([folder])
      }
      if (folderId === "folder-1") {
        return queryState([fileInFolder])
      }
      return queryState([])
    })

    usePrefetchFolderItemsMock.mockReturnValue(vi.fn())

    render(<FolderTree />)

    expect(screen.getByText("books")).toBeInTheDocument()
    expect(screen.getByText("chapter1.txt")).toBeInTheDocument()
  })

  it("prefetches folder data on hover for collapsed folders", () => {
    const folder = createItem({
      id: "folder-2",
      name: "projects",
      type: "folder",
      resourcePath: "/projects",
    })
    const prefetch = vi.fn()
    usePrefetchFolderItemsMock.mockReturnValue(prefetch)

    useFilePickerStore.setState({
      selectedFolderId: ROOT_FOLDER_ID,
      selectedFolderName: "My Drive",
      selectedFolderPath: "/",
      expandedFolderIds: [ROOT_FOLDER_ID],
    })

    useFolderItemsMock.mockImplementation((folderId: string) => {
      if (folderId === ROOT_FOLDER_ID) {
        return queryState([folder])
      }
      if (folderId === "folder-2") {
        return queryState([])
      }
      return queryState([])
    })

    render(<FolderTree />)

    const folderButton = screen.getByRole("button", { name: "projects" })
    fireEvent.mouseEnter(folderButton)

    expect(prefetch).toHaveBeenCalledWith("folder-2", "/projects")
  })

  it("loads more children when a paged node exposes more items", () => {
    const folder = createItem({
      id: "folder-3",
      name: "archive",
      type: "folder",
      resourcePath: "/archive",
    })
    const fetchNextPage = vi.fn()

    useFilePickerStore.setState({
      selectedFolderId: "folder-3",
      selectedFolderName: "archive",
      selectedFolderPath: "/archive",
      expandedFolderIds: [ROOT_FOLDER_ID, "folder-3"],
    })

    useFolderItemsMock.mockImplementation((folderId: string) => {
      if (folderId === ROOT_FOLDER_ID) {
        return queryState([folder])
      }

      if (folderId === "folder-3") {
        return {
          ...queryState([]),
          data: {
            parentId: "folder-3",
            connectionId: "conn-1",
            items: [],
            hasMore: true,
            nextCursor: "cursor-2",
          },
          hasMore: true,
          isFetchingNextPage: false,
          fetchNextPage,
        }
      }

      return queryState([])
    })

    render(<FolderTree />)

    fireEvent.click(screen.getByRole("button", { name: "Load more folders" }))

    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })
})
