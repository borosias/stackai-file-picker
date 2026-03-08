import { z } from "zod"

import type { FilePickerConfig } from "@/server/file-picker/config"
import {
  coerceIsoDate,
  normalizePath,
  type ResourceDescriptor,
} from "@/server/file-picker/domain"
import { FilePickerServerError } from "@/server/file-picker/errors"
import { stackRequest } from "@/server/file-picker/adapters/stack-ai/http-client"

const rawResourceSchema = z.object({
  resource_id: z.string().min(1),
  inode_type: z.string().optional(),
  name: z.string().optional(),
  filename: z.string().optional(),
  file_name: z.string().optional(),
  parent_id: z.string().optional(),
  resource_path: z.string().optional(),
  path: z.string().optional(),
  file_path: z.string().optional(),
  id: z.string().optional(),
  file_id: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  modified_at: z.string().optional(),
  size: z.number().optional(),
  size_bytes: z.number().optional(),
  file_size: z.number().optional(),
  content_mime: z.string().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  content_type: z.string().nullable().optional(),
  inode_path: z
    .union([
      z.object({
        path: z.string().optional(),
        full_path: z.string().optional(),
      }),
      z.record(z.string(), z.string()),
    ])
    .optional(),
})

const cursorPageSchema = z.union([
  z.array(rawResourceSchema),
  z.object({
    data: z.array(rawResourceSchema).default([]),
    current_cursor: z.string().nullable().optional(),
    next_cursor: z.string().nullable().optional(),
  }),
])

const resourcesByIdSchema = z.union([
  z.array(rawResourceSchema),
  z.object({
    data: z.array(rawResourceSchema).default([]),
  }),
  z.record(z.string(), rawResourceSchema),
])

function basenameFromPath(path: string): string {
  const normalized = normalizePath(path)
  if (normalized === "/") {
    return "My Drive"
  }

  const segments = normalized.split("/")
  return segments[segments.length - 1] || "Untitled"
}

function inferItemType(resource: z.infer<typeof rawResourceSchema>): "file" | "folder" {
  const rawType = resource.inode_type?.toLowerCase()
  if (rawType?.includes("folder") || rawType?.includes("dir")) {
    return "folder"
  }

  const mimeType =
    resource.mime_type ?? resource.content_mime ?? resource.content_type ?? null
  if (mimeType === "application/vnd.google-apps.folder") {
    return "folder"
  }

  return "file"
}

function readResourcePath(resource: z.infer<typeof rawResourceSchema>): string {
  const fromPath =
    resource.resource_path ??
    resource.path ??
    resource.file_path ??
    resource.inode_path?.full_path ??
    resource.inode_path?.path

  return normalizePath(fromPath)
}

function toResourceDescriptor(
  resource: z.infer<typeof rawResourceSchema>,
  parentIdFallback: string,
): ResourceDescriptor {
  const resourcePath = readResourcePath(resource)
  return {
    id: resource.resource_id,
    name:
      resource.name ??
      resource.filename ??
      resource.file_name ??
      basenameFromPath(resourcePath),
    type: inferItemType(resource),
    parentId: resource.parent_id ?? parentIdFallback,
    resourcePath,
    modifiedAt: coerceIsoDate(
      resource.modified_at ?? resource.updated_at ?? resource.created_at,
    ),
    sizeBytes: resource.size_bytes ?? resource.file_size ?? resource.size ?? null,
    mimeType: resource.mime_type ?? resource.content_mime ?? resource.content_type ?? null,
  }
}

function parseCursorPage(
  payload: unknown,
  parentIdFallback: string,
): {
  items: ResourceDescriptor[]
  nextCursor: string | null
} {
  const parsed = cursorPageSchema.safeParse(payload)
  if (!parsed.success) {
    throw new FilePickerServerError("Stack AI returned invalid connection resources.", {
      status: 502,
      code: "stack_contract_error",
    })
  }

  if (Array.isArray(parsed.data)) {
    return {
      items: parsed.data.map((resource) => toResourceDescriptor(resource, parentIdFallback)),
      nextCursor: null,
    }
  }

  return {
    items: parsed.data.data.map((resource) => toResourceDescriptor(resource, parentIdFallback)),
    nextCursor: parsed.data.next_cursor ?? null,
  }
}

function parseResourcesById(payload: unknown): ResourceDescriptor[] {
  const parsed = resourcesByIdSchema.safeParse(payload)
  if (!parsed.success) {
    throw new FilePickerServerError("Stack AI returned invalid connection resource details.", {
      status: 502,
      code: "stack_contract_error",
    })
  }

  if (Array.isArray(parsed.data)) {
    return parsed.data.map((resource) => toResourceDescriptor(resource, "root"))
  }

  if (
    "data" in parsed.data &&
    Array.isArray((parsed.data as { data?: unknown }).data)
  ) {
    const data = (parsed.data as { data: z.infer<typeof rawResourceSchema>[] }).data
    return data.map((resource) => toResourceDescriptor(resource, "root"))
  }

  return Object.values(parsed.data).map((resource) => toResourceDescriptor(resource, "root"))
}

export interface ConnectionResourcesPage {
  items: ResourceDescriptor[]
  hasMore: boolean
  nextCursor: string | null
}

export async function listConnectionChildren(
  config: FilePickerConfig,
  args: {
    parentId: string
    cursor?: string
    pageSize: number
  },
): Promise<ConnectionResourcesPage> {
  const payload = await stackRequest(config, {
    method: "GET",
    path: `/v1/connections/${config.connectionId}/resources/children`,
    query: {
      resource_id: args.parentId === "root" ? undefined : args.parentId,
      cursor: args.cursor,
      page_size: String(args.pageSize),
      direction: "next",
    },
  })

  const page = parseCursorPage(payload, args.parentId)
  return {
    items: page.items,
    hasMore: page.nextCursor !== null,
    nextCursor: page.nextCursor,
  }
}

export async function searchConnectionResources(
  config: FilePickerConfig,
  args: {
    query: string
    cursor?: string
    pageSize: number
  },
): Promise<ConnectionResourcesPage> {
  const payload = await stackRequest(config, {
    method: "GET",
    path: `/v1/connections/${config.connectionId}/resources/search`,
    query: {
      query: args.query,
      cursor: args.cursor,
      page_size: String(args.pageSize),
      direction: "next",
    },
  })

  const page = parseCursorPage(payload, "root")
  return {
    items: page.items,
    hasMore: page.nextCursor !== null,
    nextCursor: page.nextCursor,
  }
}

export async function getConnectionResourcesByIds(
  config: FilePickerConfig,
  resourceIds: readonly string[],
): Promise<Map<string, ResourceDescriptor>> {
  if (resourceIds.length === 0) {
    return new Map()
  }

  const payload = await stackRequest(config, {
    method: "GET",
    path: `/v1/connections/${config.connectionId}/resources`,
    query: {
      resource_ids: [...resourceIds],
    },
  })

  const items = parseResourcesById(payload)
  return new Map(items.map((item) => [item.id, item]))
}
