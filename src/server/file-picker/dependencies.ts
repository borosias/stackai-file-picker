import { getFilePickerConfig } from "@/server/file-picker/config"
import {
  createPostgresHiddenItemsRepository,
} from "@/server/file-picker/adapters/persistence/hidden-items-repository"
import type { FilePickerDependencies } from "@/server/file-picker/runtime-types"

export function getProductionDependencies(): FilePickerDependencies {
  const config = getFilePickerConfig()

  return {
    config,
    hiddenItemsRepository: createPostgresHiddenItemsRepository(config.databaseUrl),
    log: console,
  }
}
