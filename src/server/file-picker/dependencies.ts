import { getFilePickerConfig, type FilePickerConfig } from "@/server/file-picker/config"
import {
  createPostgresHiddenItemsRepository,
} from "@/server/file-picker/adapters/persistence/hidden-items-repository"
import { fetchFirstConnectionId } from "@/server/file-picker/adapters/stack-ai/connections-gateway"
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

export async function getProductionDependencies(): Promise<FilePickerDependencies> {
  const rawConfig = getFilePickerConfig()
  const config = await resolveConnectionId(rawConfig)

  return {
    config,
    hiddenItemsRepository: createPostgresHiddenItemsRepository(config.databaseUrl),
    log: console,
  }
}
