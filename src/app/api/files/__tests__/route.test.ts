import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const listFolderItemsMock = vi.hoisted(() => vi.fn())
const getFolderItemStatusesMock = vi.hoisted(() => vi.fn())
const applyItemActionMock = vi.hoisted(() => vi.fn())
const toHttpErrorMock = vi.hoisted(() => vi.fn())

vi.mock("@/server/file-picker/service", () => ({
  listFolderItems: listFolderItemsMock,
  getFolderItemStatuses: getFolderItemStatusesMock,
  applyItemAction: applyItemActionMock,
  toHttpError: toHttpErrorMock,
}))

import { GET, POST } from "@/app/api/files/route"
import { POST as POST_STATUS } from "@/app/api/files/status/route"

describe("/api/files routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toHttpErrorMock.mockReturnValue({
      status: 500,
      code: "internal_error",
      message: "Unexpected server error.",
    })
  })

  describe("GET /api/files", () => {
    it("returns folder items for a valid request", async () => {
      listFolderItemsMock.mockResolvedValue({
        parentId: "root",
        connectionId: "conn-1",
        items: [],
        hasMore: false,
        nextCursor: null,
      })

      const request = new NextRequest("http://localhost:3000/api/files?parentId=root")
      const response = await GET(request)

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        parentId: "root",
        connectionId: "conn-1",
        items: [],
        hasMore: false,
        nextCursor: null,
      })
      expect(listFolderItemsMock).toHaveBeenCalledWith("root", {
        cursor: undefined,
        includeHidden: false,
        pageSize: undefined,
        parentPath: undefined,
        query: undefined,
      })
    })

    it("passes cursor, pageSize, query and includeHidden through", async () => {
      listFolderItemsMock.mockResolvedValue({
        parentId: "root",
        connectionId: "conn-1",
        items: [],
        hasMore: true,
        nextCursor: "cursor-next",
      })

      const request = new NextRequest(
        "http://localhost:3000/api/files?parentId=root&cursor=cursor-1&pageSize=50&query=invoice&includeHidden=1",
      )
      const response = await GET(request)

      expect(response.status).toBe(200)
      expect(listFolderItemsMock).toHaveBeenCalledWith("root", {
        cursor: "cursor-1",
        includeHidden: true,
        pageSize: 50,
        parentPath: undefined,
        query: "invoice",
      })
    })

    it("returns domain error payload with code", async () => {
      const error = new Error("Not found")
      listFolderItemsMock.mockRejectedValue(error)
      toHttpErrorMock.mockReturnValue({
        status: 404,
        code: "not_found",
        message: "Connection resource not found.",
      })

      const request = new NextRequest("http://localhost:3000/api/files?parentId=root")
      const response = await GET(request)

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({
        error: "Connection resource not found.",
        code: "not_found",
      })
    })
  })

  describe("POST /api/files", () => {
    it("returns 400 for malformed JSON body", async () => {
      const request = new NextRequest("http://localhost:3000/api/files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{invalid-json",
      })

      const response = await POST(request)

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: "Request body must be valid JSON.",
      })
      expect(applyItemActionMock).not.toHaveBeenCalled()
    })

    it("applies item action for a valid request", async () => {
      applyItemActionMock.mockResolvedValue({
        action: "restore",
        affectedIds: ["abc"],
      })

      const request = new NextRequest("http://localhost:3000/api/files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          itemId: "abc",
          action: "restore",
          itemType: "file",
          resourcePath: "/docs/a.txt",
        }),
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        action: "restore",
        affectedIds: ["abc"],
      })
      expect(applyItemActionMock).toHaveBeenCalledWith({
        itemId: "abc",
        action: "restore",
        itemType: "file",
        resourcePath: "/docs/a.txt",
      })
    })

    it("returns error payload with code on action failure", async () => {
      const error = new Error("partial failure")
      applyItemActionMock.mockRejectedValue(error)
      toHttpErrorMock.mockReturnValue({
        status: 500,
        code: "partial_unlist_failure",
        message: "The item was de-indexed but could not be hidden from listing.",
      })

      const request = new NextRequest("http://localhost:3000/api/files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          itemId: "abc",
          action: "unlist",
          itemType: "file",
          resourcePath: "/docs/a.txt",
        }),
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({
        error: "The item was de-indexed but could not be hidden from listing.",
        code: "partial_unlist_failure",
      })
    })
  })

  describe("POST /api/files/status", () => {
    it("returns overlay statuses for a valid request", async () => {
      getFolderItemStatusesMock.mockResolvedValue({
        knowledgeBaseBinding: {
          state: "ready",
          knowledgeBaseId: "kb-1",
        },
        itemsById: {
          "file-1": {
            indexOrigin: "direct",
            indexState: "indexed",
            isHidden: false,
            displayStatus: {
              code: "indexed",
              label: "Indexed",
              tone: "success",
              kind: "materialization",
            },
            capabilities: {
              index: { allowed: false, reasonCode: "already_indexed_direct" },
              deindex: { allowed: true },
              unlist: { allowed: true },
              restore: { allowed: false, reasonCode: "not_hidden" },
            },
          },
        },
      })

      const request = new NextRequest("http://localhost:3000/api/files/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "browse",
          parentPath: "/",
          items: [
            {
              id: "file-1",
              resourcePath: "/file-1.txt",
              type: "file",
            },
          ],
        }),
      })

      const response = await POST_STATUS(request)

      expect(response.status).toBe(200)
      expect(getFolderItemStatusesMock).toHaveBeenCalledWith({
        mode: "browse",
        parentPath: "/",
        items: [
          {
            id: "file-1",
            resourcePath: "/file-1.txt",
            type: "file",
          },
        ],
      })
    })

    it("returns 400 for invalid status payload", async () => {
      const request = new NextRequest("http://localhost:3000/api/files/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "browse",
          items: [{ id: "file-1" }],
        }),
      })

      const response = await POST_STATUS(request)

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({
        error: "Invalid status payload.",
        code: "validation_error",
      })
    })
  })
})
