import { z } from "zod"

import type { DriveItemType } from "@/lib/drive-types"
import type { FilePickerConfig } from "@/server/file-picker/config"
import { normalizePath } from "@/server/file-picker/domain"
import { FilePickerServerError } from "@/server/file-picker/errors"
import { stackRequest } from "@/server/file-picker/adapters/stack-ai/http-client"

const knowledgeBaseSchema = z.object({
  knowledge_base_id: z.string().min(1),
  connection_id: z.string().min(1).nullable().optional(),
  connection_source_ids: z.array(z.string().min(1)).default([]),
  name: z.string().optional(),
  description: z.string().optional(),
})

const rawKnowledgeBaseResourceSchema = z.object({
  resource_id: z.string().min(1),
  status: z.string().optional(),
  resource_path: z.string().optional(),
  path: z.string().optional(),
  file_path: z.string().optional(),
  inode_path: z
    .union([
      z.object({
        path: z.string().optional(),
        full_path: z.string().optional(),
      }),
      z.record(z.string(), z.string()),
    ])
    .optional(),
  inode_type: z.string().optional(),
})

const kbResourcesPageSchema = z.union([
  z.array(rawKnowledgeBaseResourceSchema),
  z.object({
    data: z.array(rawKnowledgeBaseResourceSchema).default([]),
    next_cursor: z.string().nullable().optional(),
    current_cursor: z.string().nullable().optional(),
  }),
  z.record(z.string(), rawKnowledgeBaseResourceSchema),
])

function inferType(inodeType: string | undefined): DriveItemType {
  const normalized = inodeType?.toLowerCase()
  if (normalized?.includes("folder") || normalized?.includes("dir")) {
    return "folder"
  }

  return "file"
}

function readResourcePath(resource: z.infer<typeof rawKnowledgeBaseResourceSchema>): string {
  return normalizePath(
    resource.resource_path ??
      resource.path ??
      resource.file_path ??
      resource.inode_path?.full_path ??
      resource.inode_path?.path,
  )
}

export interface KnowledgeBaseDetails {
  knowledgeBaseId: string
  connectionId: string
  connectionSourceIds: string[]
  name?: string
  description?: string
}

export interface KnowledgeBaseStatusResource {
  id: string
  resourcePath: string
  status: string | undefined
  type: DriveItemType
  isVirtualDirectory: boolean
}

function parseKnowledgeBase(payload: unknown): KnowledgeBaseDetails {
  const parsed = knowledgeBaseSchema.safeParse(payload)
  if (!parsed.success || !parsed.data.connection_id) {
    throw new FilePickerServerError("Stack AI returned invalid knowledge base details.", {
      status: 502,
      code: "stack_contract_error",
    })
  }

  return {
    knowledgeBaseId: parsed.data.knowledge_base_id,
    connectionId: parsed.data.connection_id,
    connectionSourceIds: parsed.data.connection_source_ids,
    name: parsed.data.name,
    description: parsed.data.description,
  }
}

function parseKnowledgeBaseResources(payload: unknown): KnowledgeBaseStatusResource[] {
  const parsed = kbResourcesPageSchema.safeParse(payload)
  if (!parsed.success) {
    throw new FilePickerServerError("Stack AI returned invalid knowledge base resources.", {
      status: 502,
      code: "stack_contract_error",
    })
  }

  const rows = Array.isArray(parsed.data)
    ? parsed.data
    : "data" in parsed.data
      ? ((parsed.data as { data: z.infer<typeof rawKnowledgeBaseResourceSchema>[] }).data)
      : Object.values(parsed.data)

  return rows.map((resource) => ({
    id: resource.resource_id,
    resourcePath: readResourcePath(resource),
    status: resource.status,
    type: inferType(resource.inode_type),
    isVirtualDirectory: resource.resource_id === "STACK_VFS_VIRTUAL_DIRECTORY",
  }))
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((value) => value.trim()))]
}

export async function getKnowledgeBaseDetails(
  config: FilePickerConfig,
): Promise<KnowledgeBaseDetails> {
  if (!config.knowledgeBaseId) {
    throw new FilePickerServerError("STACKAI_KNOWLEDGE_BASE_ID is not configured.", {
      status: 500,
      code: "missing_config",
    })
  }

  const payload = await stackRequest(config, {
    method: "GET",
    path: `/v1/knowledge-bases/${config.knowledgeBaseId}`,
  })

  return parseKnowledgeBase(payload)
}

export async function listKnowledgeBaseChildren(
  config: FilePickerConfig,
  parentPath: string,
): Promise<KnowledgeBaseStatusResource[]> {
  if (!config.knowledgeBaseId) {
    return []
  }

  const payload = await stackRequest(config, {
    method: "GET",
    path: `/v1/knowledge-bases/${config.knowledgeBaseId}/resources/children`,
    query: {
      resource_path: normalizePath(parentPath),
    },
  })

  return parseKnowledgeBaseResources(payload)
}

export async function searchKnowledgeBaseResources(
  config: FilePickerConfig,
  query: string,
): Promise<KnowledgeBaseStatusResource[]> {
  if (!config.knowledgeBaseId) {
    return []
  }

  const payload = await stackRequest(config, {
    method: "GET",
    path: `/v1/knowledge-bases/${config.knowledgeBaseId}/search`,
    query: {
      search_query: query,
    },
  })

  return parseKnowledgeBaseResources(payload)
}

export async function updateKnowledgeBaseSources(
  config: FilePickerConfig,
  details: KnowledgeBaseDetails,
  connectionSourceIds: readonly string[],
): Promise<KnowledgeBaseDetails> {
  const payload = await stackRequest(config, {
    method: "PATCH",
    path: `/v1/knowledge-bases/${details.knowledgeBaseId}`,
    body: {
      connection_id: details.connectionId,
      connection_source_ids: uniqueIds(connectionSourceIds),
      name: details.name ?? "Unnamed Knowledge Base",
      description: details.description ?? "",
    },
  })

  return parseKnowledgeBase(payload)
}

export async function syncKnowledgeBase(
  config: FilePickerConfig,
  knowledgeBaseId: string,
): Promise<void> {
  await stackRequest(config, {
    method: "POST",
    path: `/v1/knowledge-bases/${knowledgeBaseId}/sync`,
  })
}

export async function deleteKnowledgeBaseResourceByPath(
  config: FilePickerConfig,
  knowledgeBaseId: string,
  resourcePath: string,
): Promise<void> {
  await stackRequest(config, {
    method: "DELETE",
    path: `/v1/knowledge-bases/${knowledgeBaseId}/resources`,
    query: {
      resource_path: normalizePath(resourcePath),
    },
  })
}

export async function bulkDeleteKnowledgeBaseResources(
  config: FilePickerConfig,
  knowledgeBaseId: string,
  inodeIds: readonly string[],
): Promise<void> {
  await stackRequest(config, {
    method: "DELETE",
    path: `/v1/knowledge-bases/${knowledgeBaseId}/resources/bulk`,
    body: {
      selection: "list",
      inode_ids: inodeIds,
    },
  })
}
