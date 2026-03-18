import { getFilePickerConfig, type FilePickerConfig } from "@/server/file-picker/config"
import {
  createPostgresHiddenItemsRepository,
} from "@/server/file-picker/adapters/persistence/hidden-items-repository"
import {
  createPostgresKbOverridesRepository,
  type KbOverridesRepository,
} from "@/server/file-picker/adapters/persistence/kb-overrides-repository"
import { fetchFirstConnectionId } from "@/server/file-picker/adapters/stack-ai/connections-gateway"
import {
  createKnowledgeBase,
  getKnowledgeBaseDetails,
  syncKnowledgeBase,
} from "@/server/file-picker/adapters/stack-ai/knowledge-bases-gateway"
import { toHttpError } from "@/server/file-picker/errors"
import type { FilePickerDependencies } from "@/server/file-picker/runtime-types"

let connectionIdPromise: Promise<string> | undefined

async function resolveConnectionId(config: FilePickerConfig): Promise<FilePickerConfig> {
  if (config.connectionId) {
    return config
  }

  if (!connectionIdPromise) {
    connectionIdPromise = fetchFirstConnectionId(config).catch((err) => {
      connectionIdPromise = undefined
      throw err
    })
  }

  const connectionId = await connectionIdPromise
  return { ...config, connectionId }
}

let kbIdPromise: Promise<string> | undefined

async function resolveKnowledgeBaseId(
  config: FilePickerConfig,
  kbOverrides: KbOverridesRepository,
): Promise<FilePickerConfig> {
  const envId = config.knowledgeBaseId
  const dbId = await kbOverrides.getKnowledgeBaseId(config.connectionId)
  const effectiveId = dbId || envId

  if (effectiveId) {
    try {
      await getKnowledgeBaseDetails({ ...config, knowledgeBaseId: effectiveId })
      return { ...config, knowledgeBaseId: effectiveId }
    } catch (error) {
      const httpError = toHttpError(error)
      if (httpError.status !== 404) {
        return { ...config, knowledgeBaseId: effectiveId }
      }
      // 404 — KB deleted, fall through to auto-create
    }
  }

  const created = await createKnowledgeBase(config, config.connectionId)
  await syncKnowledgeBase(config, created.knowledgeBaseId)
  await kbOverrides.setKnowledgeBaseId(config.connectionId, created.knowledgeBaseId)
  console.warn(
    `[file-picker] Auto-created knowledge base ${created.knowledgeBaseId}` +
      (effectiveId ? ` (replacing missing ${effectiveId})` : ""),
  )
  return { ...config, knowledgeBaseId: created.knowledgeBaseId }
}

export async function getProductionDependencies(): Promise<FilePickerDependencies> {
  const rawConfig = getFilePickerConfig()
  const config = await resolveConnectionId(rawConfig)
  const kbOverrides = createPostgresKbOverridesRepository(config.databaseUrl)

  if (!kbIdPromise) {
    kbIdPromise = resolveKnowledgeBaseId(config, kbOverrides)
      .then((c) => c.knowledgeBaseId!)
      .catch((err) => {
        kbIdPromise = undefined
        throw err
      })
  }

  let finalConfig: FilePickerConfig
  try {
    const knowledgeBaseId = await kbIdPromise
    finalConfig = { ...config, knowledgeBaseId }
  } catch {
    // Auto-create failed — continue without KB (browse-only mode)
    finalConfig = config
  }

  return {
    config: finalConfig,
    hiddenItemsRepository: createPostgresHiddenItemsRepository(finalConfig.databaseUrl),
    log: console,
  }
}
