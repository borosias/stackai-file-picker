import {
  folderItemsResponseSchema,
  itemActionResponseSchema,
  statusOverlayRequestSchema,
  statusOverlayResponseSchema,
  type FolderItemsResponse,
  type ItemActionPayload,
  type ItemActionResponse,
  type StatusOverlayRequest,
  type StatusOverlayResponse,
} from "@/lib/drive-types"

function parseApiError(payload: unknown, status: number): string {
  if (typeof payload === "string" && payload.trim()) {
    const normalized = payload.trim()
    const htmlLike = /^<!doctype html>/i.test(normalized) || /^<html/i.test(normalized)

    if (status === 404 && htmlLike) {
      return "Local API route /api/files is unavailable. Restart Next.js from the project folder so route handlers are loaded."
    }

    return normalized
  }

  if (typeof payload === "object" && payload !== null) {
    const record = payload as Record<string, unknown>
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message
    }
  }

  if (status === 404) {
    return "Requested resource was not found."
  }

  return `Request failed with status ${status}.`
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    return response.json()
  }
  return response.text()
}

interface FetchFolderItemsArgs {
  parentId: string
  parentPath?: string
  cursor?: string
  pageSize?: number
  query?: string
  includeHidden?: boolean
}

export async function fetchFolderItems(
  args: FetchFolderItemsArgs,
  signal?: AbortSignal,
): Promise<FolderItemsResponse> {
  const params = new URLSearchParams({
    parentId: args.parentId,
  })
  if (args.parentPath) {
    params.set("parentPath", args.parentPath)
  }
  if (args.cursor) {
    params.set("cursor", args.cursor)
  }
  if (args.pageSize) {
    params.set("pageSize", String(args.pageSize))
  }
  if (args.query) {
    params.set("query", args.query)
  }
  if (args.includeHidden) {
    params.set("includeHidden", "1")
  }

  const response = await fetch(`/api/files?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    signal,
  })

  const payload = await readResponsePayload(response)
  if (!response.ok) {
    throw new Error(parseApiError(payload, response.status))
  }

  const parsed = folderItemsResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error("Server returned invalid folder data.")
  }

  return parsed.data
}

export async function executeItemAction(
  payload: ItemActionPayload,
): Promise<ItemActionResponse> {
  const response = await fetch("/api/files", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const body = await readResponsePayload(response)
  if (!response.ok) {
    throw new Error(parseApiError(body, response.status))
  }

  const parsed = itemActionResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new Error("Server returned invalid action response.")
  }

  return parsed.data
}

export async function fetchFolderItemStatuses(
  payload: StatusOverlayRequest,
): Promise<StatusOverlayResponse> {
  const parsedPayload = statusOverlayRequestSchema.safeParse(payload)
  if (!parsedPayload.success) {
    throw new Error("Invalid status request payload.")
  }

  const response = await fetch("/api/files/status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parsedPayload.data),
  })

  const body = await readResponsePayload(response)
  if (!response.ok) {
    throw new Error(parseApiError(body, response.status))
  }

  const parsed = statusOverlayResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new Error("Server returned invalid status data.")
  }

  return parsed.data
}
