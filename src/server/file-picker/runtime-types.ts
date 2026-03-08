import type {
  FolderItemsResponse,
  KnowledgeBaseBinding,
  StatusOverlayRequest,
} from "@/lib/drive-types"
import type { FilePickerConfig } from "@/server/file-picker/config"
import type { SourceDescriptor } from "@/server/file-picker/domain"
import type { HiddenItemsRepository } from "@/server/file-picker/adapters/persistence/hidden-items-repository"
import type { KnowledgeBaseDetails } from "@/server/file-picker/adapters/stack-ai/knowledge-bases-gateway"

export interface ListFolderOptions {
  parentPath?: string
  cursor?: string
  pageSize?: number
  query?: string
  includeHidden?: boolean
}

export interface FilePickerDependencies {
  config: FilePickerConfig
  hiddenItemsRepository: HiddenItemsRepository
  log: Pick<Console, "error">
}

export interface KnowledgeBaseSourceState {
  rawSourceIds: Set<string>
  resolvedFolderSources: SourceDescriptor[]
}

export interface StatusSnapshot {
  presentInKb: boolean
  indexState: FolderItemsResponse["items"][number]["indexState"]
  sourceMembership: FolderItemsResponse["items"][number]["indexOrigin"]
  isFullyIndexed: boolean
}

export type ResolvedBinding =
  | {
      public: KnowledgeBaseBinding
      details?: undefined
    }
  | {
      public: KnowledgeBaseBinding
      details: KnowledgeBaseDetails
    }

export type StatusMode = StatusOverlayRequest["mode"]
