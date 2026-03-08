// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { FilePickerShell } from "@/features/file-picker/components/file-picker-shell"
import { ROOT_FOLDER_ID, type DriveItem } from "@/lib/drive-types"
import { useFilePickerStore } from "@/features/file-picker/store"

const replaceMock = vi.hoisted(() => vi.fn())
const useFolderItemsMock = vi.hoisted(() => vi.fn())
const useFolderItemStatusesMock = vi.hoisted(() => vi.fn())
const useItemActionMutationMock = vi.hoisted(() => vi.fn())
const usePrefetchFolderItemsMock = vi.hoisted(() => vi.fn())
const mergeItemsWithStatusesMock = vi.hoisted(() => vi.fn())
const searchParamsMock = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: searchParamsMock,
}))

vi.mock("@/features/file-picker/hooks", () => ({
  useFolderItems: useFolderItemsMock,
  useFolderItemStatuses: useFolderItemStatusesMock,
  useItemActionMutation: useItemActionMutationMock,
  usePrefetchFolderItems: usePrefetchFolderItemsMock,
  mergeItemsWithStatuses: mergeItemsWithStatusesMock,
}))

vi.mock("@/features/file-picker/components/folder-tree", () => ({
  FolderTree: () => <div data-testid="folder-tree">Folder tree</div>,
}))

vi.mock("@/features/file-picker/components/file-list", () => ({
  FileList: ({ items }: { items: readonly DriveItem[] }) => (
    <div data-testid="file-list">items:{items.length}</div>
  ),
}))

describe("FilePickerShell", () => {
  beforeEach(() => {
    useFilePickerStore.setState({
      selectedFolderId: ROOT_FOLDER_ID,
      selectedFolderName: "My Drive",
      selectedFolderPath: "/",
      expandedFolderIds: [ROOT_FOLDER_ID],
    })

    useFolderItemsMock.mockReset()
    useFolderItemStatusesMock.mockReset()
    useItemActionMutationMock.mockReset()
    usePrefetchFolderItemsMock.mockReset()
    mergeItemsWithStatusesMock.mockReset()
    searchParamsMock.mockReturnValue(new URLSearchParams(""))

    useItemActionMutationMock.mockReturnValue({
      mutate: vi.fn(),
      pendingActionsByItemId: {},
      transientStatusesByItemId: {},
      activeTransitionsByItemId: {},
      clearCompletedTransition: vi.fn(),
    })
    usePrefetchFolderItemsMock.mockReturnValue(vi.fn())
    useFolderItemStatusesMock.mockReturnValue({
      data: undefined,
      knowledgeBaseBinding: undefined,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
  })

  it("renders top stats and forwards merged items to file list", () => {
    const items: DriveItem[] = [
      {
        id: "a",
        name: "docs",
        type: "folder",
        parentId: ROOT_FOLDER_ID,
        resourcePath: "/docs",
        modifiedAt: "2026-01-01T10:00:00.000Z",
        indexState: "unknown",
        indexOrigin: "unknown",
      },
    ]

    useFolderItemsMock.mockReturnValue({
      data: {
        parentId: ROOT_FOLDER_ID,
        connectionId: "conn-1",
        items,
        hasMore: false,
        nextCursor: null,
      },
      connectionId: "conn-1",
      isPending: false,
      isError: false,
      error: null,
      hasMore: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    mergeItemsWithStatusesMock.mockReturnValue(items)

    render(<FilePickerShell />)

    expect(screen.getByText("Google Drive Picker")).toBeInTheDocument()
    expect(screen.getByText("Visible")).toBeInTheDocument()
    expect(screen.getByTestId("folder-tree")).toBeInTheDocument()
    expect(screen.getByTestId("file-list")).toHaveTextContent("items:1")
  })

  it("switches to search mode when q is present in URL params", () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("q=contracts"))
    useFolderItemsMock.mockReturnValue({
      data: {
        parentId: ROOT_FOLDER_ID,
        connectionId: "conn-1",
        items: [],
        hasMore: false,
        nextCursor: null,
      },
      connectionId: "conn-1",
      isPending: false,
      isError: false,
      error: null,
      hasMore: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    mergeItemsWithStatusesMock.mockReturnValue([])

    render(<FilePickerShell />)

    expect(useFolderItemsMock).toHaveBeenCalledWith(
      ROOT_FOLDER_ID,
      expect.objectContaining({
        parentPath: "/",
        query: "contracts",
      }),
    )
    expect(useFolderItemStatusesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "search",
        query: "contracts",
      }),
    )
    expect(screen.getByText("Search results")).toBeInTheDocument()
  })

  it("keeps the list visible and shows a retry banner when status overlay fails", () => {
    const items: DriveItem[] = [
      {
        id: "folder-a",
        name: "clients",
        type: "folder",
        parentId: ROOT_FOLDER_ID,
        resourcePath: "/clients",
        modifiedAt: "2026-01-01T10:00:00.000Z",
        indexState: "unknown",
        indexOrigin: "unknown",
      },
    ]
    const refetchMock = vi.fn()

    useFolderItemsMock.mockReturnValue({
      data: {
        parentId: ROOT_FOLDER_ID,
        connectionId: "conn-1",
        items,
        hasMore: false,
        nextCursor: null,
      },
      connectionId: "conn-1",
      isPending: false,
      isError: false,
      error: null,
      hasMore: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    useFolderItemStatusesMock.mockReturnValue({
      data: undefined,
      knowledgeBaseBinding: undefined,
      isPending: false,
      isError: true,
      error: new Error("Status overlay failed."),
      refetch: refetchMock,
    })
    mergeItemsWithStatusesMock.mockReturnValue(items)

    render(<FilePickerShell />)

    expect(screen.getByTestId("file-list")).toHaveTextContent("items:1")
    expect(screen.getByText("Status overlay failed.")).toBeInTheDocument()
    expect(screen.getAllByText("Unavailable")).toHaveLength(2)

    fireEvent.click(screen.getByRole("button", { name: "Retry status" }))

    expect(refetchMock).toHaveBeenCalledTimes(1)
  })
})
