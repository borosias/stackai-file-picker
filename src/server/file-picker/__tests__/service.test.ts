import { beforeEach, describe, expect, it, vi } from "vitest"

const listConnectionChildrenMock = vi.hoisted(() => vi.fn())
const searchConnectionResourcesMock = vi.hoisted(() => vi.fn())
const getConnectionResourcesByIdsMock = vi.hoisted(() => vi.fn())
const getKnowledgeBaseDetailsMock = vi.hoisted(() => vi.fn())
const listKnowledgeBaseChildrenMock = vi.hoisted(() => vi.fn())
const searchKnowledgeBaseResourcesMock = vi.hoisted(() => vi.fn())
const updateKnowledgeBaseSourcesMock = vi.hoisted(() => vi.fn())
const syncKnowledgeBaseMock = vi.hoisted(() => vi.fn())
const deleteKnowledgeBaseResourceByPathMock = vi.hoisted(() => vi.fn())
const bulkDeleteKnowledgeBaseResourcesMock = vi.hoisted(() => vi.fn())

vi.mock("@/server/file-picker/adapters/stack-ai/connections-gateway", () => ({
  listConnectionChildren: listConnectionChildrenMock,
  searchConnectionResources: searchConnectionResourcesMock,
  getConnectionResourcesByIds: getConnectionResourcesByIdsMock,
}))

vi.mock("@/server/file-picker/adapters/stack-ai/knowledge-bases-gateway", () => ({
  getKnowledgeBaseDetails: getKnowledgeBaseDetailsMock,
  listKnowledgeBaseChildren: listKnowledgeBaseChildrenMock,
  searchKnowledgeBaseResources: searchKnowledgeBaseResourcesMock,
  updateKnowledgeBaseSources: updateKnowledgeBaseSourcesMock,
  syncKnowledgeBase: syncKnowledgeBaseMock,
  deleteKnowledgeBaseResourceByPath: deleteKnowledgeBaseResourceByPathMock,
  bulkDeleteKnowledgeBaseResources: bulkDeleteKnowledgeBaseResourcesMock,
}))

import { createInMemoryHiddenItemsRepository } from "@/server/file-picker/adapters/persistence/hidden-items-repository"
import { FilePickerServerError } from "@/server/file-picker/errors"
import {
  applyItemAction,
  getFolderItemStatuses,
  listFolderItems,
  resetFilePickerServiceCachesForTests,
} from "@/server/file-picker/service"

const BASE_CONFIG = {
  apiBaseUrl: "https://api.stackai.test",
  authBaseUrl: "https://auth.stackai.test",
  connectionId: "conn-1",
  databaseUrl: "postgres://unused",
}

function createDependencies(overrides?: {
  knowledgeBaseId?: string
  hiddenItemsRepository?: ReturnType<typeof createInMemoryHiddenItemsRepository>
}) {
  return {
    config: {
      ...BASE_CONFIG,
      knowledgeBaseId: overrides?.knowledgeBaseId,
    },
    hiddenItemsRepository:
      overrides?.hiddenItemsRepository ?? createInMemoryHiddenItemsRepository(),
    log: console,
  }
}

describe("file-picker service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchKnowledgeBaseResourcesMock.mockResolvedValue([])
    resetFilePickerServiceCachesForTests()
  })

  it("filters hidden items from GET by default and includes them when requested", async () => {
    listConnectionChildrenMock.mockResolvedValue({
      items: [
        {
          id: "file-1",
          name: "visible.txt",
          type: "file",
          parentId: "root",
          resourcePath: "/visible.txt",
          modifiedAt: "2026-01-01T10:00:00.000Z",
          sizeBytes: null,
          mimeType: null,
        },
        {
          id: "file-2",
          name: "hidden.txt",
          type: "file",
          parentId: "root",
          resourcePath: "/hidden.txt",
          modifiedAt: "2026-01-01T10:00:00.000Z",
          sizeBytes: null,
          mimeType: null,
        },
      ],
      hasMore: false,
      nextCursor: null,
    })

    const hiddenItemsRepository = createInMemoryHiddenItemsRepository([
      {
        connectionId: "conn-1",
        resourceId: "file-2",
        resourcePath: "/hidden.txt",
      },
    ])

    const visibleOnly = await listFolderItems(
      "root",
      undefined,
      createDependencies({
        knowledgeBaseId: "kb-1",
        hiddenItemsRepository,
      }),
    )
    const withHidden = await listFolderItems(
      "root",
      { includeHidden: true },
      createDependencies({
        knowledgeBaseId: "kb-1",
        hiddenItemsRepository,
      }),
    )

    expect(visibleOnly.items.map((item) => item.id)).toEqual(["file-1"])
    expect(withHidden.items.map((item) => [item.id, item.isHidden])).toEqual([
      ["file-1", false],
      ["file-2", true],
    ])
    expect(getKnowledgeBaseDetailsMock).not.toHaveBeenCalled()
  })

  it("returns missing_config binding from status overlay without KB lookup", async () => {
    const response = await getFolderItemStatuses(
      {
        mode: "browse",
        parentPath: "/",
        items: [{ id: "file-1", resourcePath: "/file-1.txt", type: "file" }],
      },
      createDependencies(),
    )

    expect(response.knowledgeBaseBinding.state).toBe("missing_config")
    expect(response.itemsById["file-1"]).toMatchObject({
      presentInKb: false,
      indexOrigin: "unknown",
      indexState: "unknown",
      displayStatus: {
        code: "status_unavailable",
        label: "Status unavailable",
      },
    })
    expect(getKnowledgeBaseDetailsMock).not.toHaveBeenCalled()
  })

  it("marks a parent folder as partially in KB when only a child subtree is selected", async () => {
    getKnowledgeBaseDetailsMock.mockResolvedValue({
      knowledgeBaseId: "kb-1",
      connectionId: "conn-1",
      connectionSourceIds: ["folder-current"],
    })
    getConnectionResourcesByIdsMock.mockResolvedValue(
      new Map([
        [
          "folder-current",
          {
            id: "folder-current",
            name: "current",
            type: "folder",
            parentId: "folder-clients",
            resourcePath: "/clients/current",
            modifiedAt: "2026-01-01T10:00:00.000Z",
            sizeBytes: null,
            mimeType: null,
          },
        ],
      ]),
    )
    listKnowledgeBaseChildrenMock.mockResolvedValue([
      {
        id: "STACK_VFS_VIRTUAL_DIRECTORY",
        resourcePath: "/clients",
        status: undefined,
        type: "folder",
        isVirtualDirectory: true,
      },
    ])

    const response = await getFolderItemStatuses(
      {
        mode: "browse",
        parentPath: "/",
        items: [{ id: "folder-clients", resourcePath: "/clients", type: "folder" }],
      },
      createDependencies({ knowledgeBaseId: "kb-1" }),
    )

    expect(response.itemsById["folder-clients"]).toMatchObject({
      presentInKb: true,
      indexOrigin: "none",
      displayStatus: {
        code: "partially_in_kb",
        label: "Partially in KB",
      },
    })
  })

  it("marks a child folder as fully indexed when covered by a parent source", async () => {
    getKnowledgeBaseDetailsMock.mockResolvedValue({
      knowledgeBaseId: "kb-1",
      connectionId: "conn-1",
      connectionSourceIds: ["folder-clients"],
    })
    getConnectionResourcesByIdsMock.mockResolvedValue(
      new Map([
        [
          "folder-clients",
          {
            id: "folder-clients",
            name: "clients",
            type: "folder",
            parentId: "root",
            resourcePath: "/clients",
            modifiedAt: "2026-01-01T10:00:00.000Z",
            sizeBytes: null,
            mimeType: null,
          },
        ],
      ]),
    )
    listKnowledgeBaseChildrenMock.mockResolvedValue([
      {
        id: "STACK_VFS_VIRTUAL_DIRECTORY",
        resourcePath: "/clients/current",
        status: undefined,
        type: "folder",
        isVirtualDirectory: true,
      },
    ])

    const response = await getFolderItemStatuses(
      {
        mode: "browse",
        parentPath: "/clients",
        items: [{ id: "folder-current", resourcePath: "/clients/current", type: "folder" }],
      },
      createDependencies({ knowledgeBaseId: "kb-1" }),
    )

    expect(response.itemsById["folder-current"]).toMatchObject({
      presentInKb: true,
      indexOrigin: "inherited",
      displayStatus: {
        code: "in_kb",
        label: "Fully indexed",
      },
    })
  })

  it("uses a single KB children read for browse overlays", async () => {
    getKnowledgeBaseDetailsMock.mockResolvedValue({
      knowledgeBaseId: "kb-1",
      connectionId: "conn-1",
      connectionSourceIds: [],
    })
    listKnowledgeBaseChildrenMock.mockResolvedValue([
      {
        id: "file-a",
        resourcePath: "/docs/a.txt",
        status: "indexed",
        type: "file",
        isVirtualDirectory: false,
      },
      {
        id: "file-b",
        resourcePath: "/docs/b.txt",
        status: undefined,
        type: "file",
        isVirtualDirectory: false,
      },
    ])

    const response = await getFolderItemStatuses(
      {
        mode: "browse",
        parentPath: "/docs",
        items: [
          { id: "file-a", resourcePath: "/docs/a.txt", type: "file" },
          { id: "file-b", resourcePath: "/docs/b.txt", type: "file" },
        ],
      },
      createDependencies({ knowledgeBaseId: "kb-1" }),
    )

    expect(listKnowledgeBaseChildrenMock).toHaveBeenCalledTimes(1)
    expect(listKnowledgeBaseChildrenMock).toHaveBeenCalledWith(
      expect.anything(),
      "/docs",
    )
    expect(response.itemsById["file-a"]).toMatchObject({
      presentInKb: true,
      displayStatus: { code: "in_kb" },
    })
    expect(response.itemsById["file-b"]).toMatchObject({
      presentInKb: true,
      displayStatus: { code: "in_kb" },
    })
  })

  it("uses only KB search in search mode and keeps folder status balanced", async () => {
    getKnowledgeBaseDetailsMock.mockResolvedValue({
      knowledgeBaseId: "kb-1",
      connectionId: "conn-1",
      connectionSourceIds: [],
    })
    searchKnowledgeBaseResourcesMock.mockResolvedValue([
      {
        id: "STACK_VFS_VIRTUAL_DIRECTORY",
        resourcePath: "/clients",
        status: undefined,
        type: "folder",
        isVirtualDirectory: true,
      },
      {
        id: "file-a",
        resourcePath: "/clients/a.txt",
        status: "indexed",
        type: "file",
        isVirtualDirectory: false,
      },
    ])

    const response = await getFolderItemStatuses(
      {
        mode: "search",
        query: "clients",
        items: [
          { id: "folder-clients", resourcePath: "/clients", type: "folder" },
          { id: "file-a", resourcePath: "/clients/a.txt", type: "file" },
        ],
      },
      createDependencies({ knowledgeBaseId: "kb-1" }),
    )

    expect(searchKnowledgeBaseResourcesMock).toHaveBeenCalledTimes(1)
    expect(listKnowledgeBaseChildrenMock).not.toHaveBeenCalled()
    expect(response.itemsById["folder-clients"]).toMatchObject({
      presentInKb: true,
      displayStatus: {
        code: "in_kb",
        label: "In KB",
      },
    })
    expect(response.itemsById["file-a"]).toMatchObject({
      presentInKb: true,
      displayStatus: {
        code: "in_kb",
        label: "In KB",
      },
    })
  })

  it("keeps sibling source ids when indexing a new subtree", async () => {
    getKnowledgeBaseDetailsMock.mockResolvedValue({
      knowledgeBaseId: "kb-1",
      connectionId: "conn-1",
      connectionSourceIds: ["folder-archived"],
    })
    updateKnowledgeBaseSourcesMock.mockResolvedValue({
      knowledgeBaseId: "kb-1",
      connectionId: "conn-1",
      connectionSourceIds: ["folder-archived", "folder-current"],
    })

    const response = await applyItemAction(
      {
        action: "index",
        itemId: "folder-current",
        itemType: "folder",
        resourcePath: "/clients/current",
      },
      createDependencies({ knowledgeBaseId: "kb-1" }),
    )

    expect(updateKnowledgeBaseSourcesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ knowledgeBaseId: "kb-1" }),
      ["folder-archived", "folder-current"],
    )
    expect(syncKnowledgeBaseMock).toHaveBeenCalledWith(expect.anything(), "kb-1")
    expect(response).toEqual({
      action: "index",
      affectedIds: ["folder-current"],
    })
  })

  it("allows deindexing a child folder under an indexed parent without policy blocking", async () => {
    getKnowledgeBaseDetailsMock.mockResolvedValue({
      knowledgeBaseId: "kb-1",
      connectionId: "conn-1",
      connectionSourceIds: ["folder-clients"],
    })
    getConnectionResourcesByIdsMock.mockResolvedValue(
      new Map([
        [
          "folder-clients",
          {
            id: "folder-clients",
            name: "clients",
            type: "folder",
            parentId: "root",
            resourcePath: "/clients",
            modifiedAt: "2026-01-01T10:00:00.000Z",
            sizeBytes: null,
            mimeType: null,
          },
        ],
      ]),
    )
    listKnowledgeBaseChildrenMock.mockResolvedValue([
      {
        id: "STACK_VFS_VIRTUAL_DIRECTORY",
        resourcePath: "/clients/current",
        status: undefined,
        type: "folder",
        isVirtualDirectory: true,
      },
    ])

    const response = await applyItemAction(
      {
        action: "deindex",
        itemId: "folder-current",
        itemType: "folder",
        resourcePath: "/clients/current",
      },
      createDependencies({ knowledgeBaseId: "kb-1" }),
    )

    expect(bulkDeleteKnowledgeBaseResourcesMock).toHaveBeenCalledWith(
      expect.anything(),
      "kb-1",
      ["clients/current"],
    )
    expect(updateKnowledgeBaseSourcesMock).not.toHaveBeenCalled()
    expect(syncKnowledgeBaseMock).toHaveBeenCalledWith(expect.anything(), "kb-1")
    expect(response).toEqual({
      action: "deindex",
      affectedIds: ["folder-current"],
    })
  })

  it("removes direct files from KB rows and exact source ids on deindex", async () => {
    getKnowledgeBaseDetailsMock.mockResolvedValue({
      knowledgeBaseId: "kb-1",
      connectionId: "conn-1",
      connectionSourceIds: ["file-1", "folder-clients"],
    })
    listKnowledgeBaseChildrenMock.mockResolvedValue([
      {
        id: "file-1",
        resourcePath: "/rootfile1.txt",
        status: "indexed",
        type: "file",
        isVirtualDirectory: false,
      },
    ])
    updateKnowledgeBaseSourcesMock.mockResolvedValue({
      knowledgeBaseId: "kb-1",
      connectionId: "conn-1",
      connectionSourceIds: ["folder-clients"],
    })

    await applyItemAction(
      {
        action: "deindex",
        itemId: "file-1",
        itemType: "file",
        resourcePath: "/rootfile1.txt",
      },
      createDependencies({ knowledgeBaseId: "kb-1" }),
    )

    expect(deleteKnowledgeBaseResourceByPathMock).toHaveBeenCalledWith(
      expect.anything(),
      "kb-1",
      "/rootfile1.txt",
    )
    expect(updateKnowledgeBaseSourcesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ knowledgeBaseId: "kb-1" }),
      ["folder-clients"],
    )
    expect(syncKnowledgeBaseMock).toHaveBeenCalledWith(expect.anything(), "kb-1")
  })

  it("treats KB path-not-found as a normal not-in-kb state", async () => {
    getKnowledgeBaseDetailsMock.mockResolvedValue({
      knowledgeBaseId: "kb-1",
      connectionId: "conn-1",
      connectionSourceIds: [],
    })
    listKnowledgeBaseChildrenMock.mockRejectedValue(
      new FilePickerServerError(
        "Path error: Could not resolve path Error. The path 'books' does not exist.",
        {
          status: 404,
          code: "not_found",
        },
      ),
    )
    getConnectionResourcesByIdsMock.mockResolvedValue(new Map())

    const response = await getFolderItemStatuses(
      {
        mode: "browse",
        parentPath: "/books",
        items: [
          {
            id: "folder-chapters",
            resourcePath: "/books/chapters",
            type: "folder",
          },
        ],
      },
      createDependencies({ knowledgeBaseId: "kb-1" }),
    )

    expect(response.itemsById["folder-chapters"]).toMatchObject({
      presentInKb: false,
      displayStatus: {
        code: "not_in_kb",
        label: "Not in KB",
      },
    })
  })

  it("unlists non-indexed files without touching KB", async () => {
    getKnowledgeBaseDetailsMock.mockResolvedValue({
      knowledgeBaseId: "kb-1",
      connectionId: "conn-1",
      connectionSourceIds: [],
    })
    listKnowledgeBaseChildrenMock.mockResolvedValue([])

    const hiddenItemsRepository = createInMemoryHiddenItemsRepository()
    const response = await applyItemAction(
      {
        action: "unlist",
        itemId: "file-2",
        itemType: "file",
        resourcePath: "/hidden-me.txt",
      },
      createDependencies({
        knowledgeBaseId: "kb-1",
        hiddenItemsRepository,
      }),
    )

    expect(response).toEqual({
      action: "unlist",
      affectedIds: ["file-2"],
    })
    expect(hiddenItemsRepository.dump()).toEqual([
      {
        connectionId: "conn-1",
        resourceId: "file-2",
        resourcePath: "/hidden-me.txt",
      },
    ])
    expect(deleteKnowledgeBaseResourceByPathMock).not.toHaveBeenCalled()
    expect(syncKnowledgeBaseMock).not.toHaveBeenCalled()
  })
})
