import { z } from "zod"

export const ROOT_FOLDER_ID = "root"

export const driveItemTypeSchema = z.enum(["file", "folder"])
export type DriveItemType = z.infer<typeof driveItemTypeSchema>

export const indexStateSchema = z.enum([
  "unknown",
  "pending",
  "indexed",
  "not_indexed",
  "deindexing",
  "error",
])
export type IndexState = z.infer<typeof indexStateSchema>

export const indexOriginSchema = z.enum(["unknown", "none", "direct", "inherited"])
export type IndexOrigin = z.infer<typeof indexOriginSchema>

export const knowledgeBaseBindingStateSchema = z.enum([
  "ready",
  "missing_config",
  "not_found",
  "connection_mismatch",
])
export type KnowledgeBaseBindingState = z.infer<typeof knowledgeBaseBindingStateSchema>

export const knowledgeBaseBindingSchema = z.object({
  state: knowledgeBaseBindingStateSchema,
  knowledgeBaseId: z.string().min(1).nullable().optional(),
  message: z.string().min(1).optional(),
})
export type KnowledgeBaseBinding = z.infer<typeof knowledgeBaseBindingSchema>

export const capabilityReasonCodeSchema = z.enum([
  "missing_config",
  "not_found",
  "connection_mismatch",
  "inherited_item",
  "already_in_kb",
  "hidden_item",
  "already_indexed_direct",
  "already_covered_by_ancestor",
  "not_hidden",
  "unknown_status",
  "not_indexed",
  "unsupported_item_type",
])
export type CapabilityReasonCode = z.infer<typeof capabilityReasonCodeSchema>

export const actionCapabilitySchema = z.object({
  allowed: z.boolean(),
  reasonCode: capabilityReasonCodeSchema.optional(),
  reasonMessage: z.string().min(1).optional(),
})
export type ActionCapability = z.infer<typeof actionCapabilitySchema>

export const driveItemCapabilitiesSchema = z.object({
  index: actionCapabilitySchema,
  deindex: actionCapabilitySchema,
  unlist: actionCapabilitySchema,
  restore: actionCapabilitySchema,
})
export type DriveItemCapabilities = z.infer<typeof driveItemCapabilitiesSchema>

export const displayStatusCodeSchema = z.enum([
  "in_kb",
  "partially_in_kb",
  "syncing",
  "removing",
  "not_in_kb",
  "error",
  "status_unavailable",
])
export type DisplayStatusCode = z.infer<typeof displayStatusCodeSchema>

export const displayStatusToneSchema = z.enum([
  "neutral",
  "success",
  "warning",
  "danger",
  "info",
])
export type DisplayStatusTone = z.infer<typeof displayStatusToneSchema>

export const displayStatusKindSchema = z.enum([
  "source-membership",
  "tree-presence",
  "materialization",
  "binding",
])
export type DisplayStatusKind = z.infer<typeof displayStatusKindSchema>

export const displayStatusSchema = z.object({
  code: displayStatusCodeSchema,
  label: z.string().min(1),
  tone: displayStatusToneSchema,
  kind: displayStatusKindSchema,
  tooltip: z.string().min(1).optional(),
})
export type DisplayStatus = z.infer<typeof displayStatusSchema>

export const driveItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: driveItemTypeSchema,
  parentId: z.string().min(1),
  resourcePath: z.string().min(1).optional(),
  modifiedAt: z.string().min(1),
  sizeBytes: z.number().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  indexState: indexStateSchema,
  indexOrigin: indexOriginSchema,
  isHidden: z.boolean().optional(),
})
export type DriveItem = z.infer<typeof driveItemSchema>

export const folderItemsResponseSchema = z.object({
  parentId: z.string().min(1),
  connectionId: z.string().min(1),
  items: z.array(driveItemSchema),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
})
export type FolderItemsResponse = z.infer<typeof folderItemsResponseSchema>

export const itemActionSchema = z.object({
  itemId: z.string().min(1),
  action: z.enum(["index", "deindex", "unlist", "restore"]),
  itemType: driveItemTypeSchema,
  resourcePath: z.string().min(1),
})
export type ItemActionPayload = z.infer<typeof itemActionSchema>
export type ItemAction = ItemActionPayload["action"]

export const itemActionResponseSchema = z.object({
  action: itemActionSchema.shape.action,
  item: driveItemSchema.optional(),
  affectedIds: z.array(z.string()).optional(),
})
export type ItemActionResponse = z.infer<typeof itemActionResponseSchema>

export const statusOverlayModeSchema = z.enum(["browse", "search"])
export type StatusOverlayMode = z.infer<typeof statusOverlayModeSchema>

export const statusOverlayRequestItemSchema = z.object({
  id: z.string().min(1),
  resourcePath: z.string().min(1),
  type: driveItemTypeSchema,
})
export type StatusOverlayRequestItem = z.infer<typeof statusOverlayRequestItemSchema>

export const statusOverlayRequestSchema = z.object({
  mode: statusOverlayModeSchema,
  parentPath: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1).optional(),
  items: z.array(statusOverlayRequestItemSchema),
})
export type StatusOverlayRequest = z.infer<typeof statusOverlayRequestSchema>

export const statusOverlayItemSchema = z.object({
  presentInKb: z.boolean(),
  indexOrigin: indexOriginSchema,
  indexState: indexStateSchema,
  isHidden: z.boolean(),
  displayStatus: displayStatusSchema,
  capabilities: driveItemCapabilitiesSchema,
})
export type StatusOverlayItem = z.infer<typeof statusOverlayItemSchema>
export type StatusAwareDriveItem = DriveItem & {
  presentInKb?: boolean
  capabilities: DriveItemCapabilities
  displayStatus?: DisplayStatus
}

export const statusOverlayResponseSchema = z.object({
  knowledgeBaseBinding: knowledgeBaseBindingSchema,
  itemsById: z.record(z.string(), statusOverlayItemSchema),
})
export type StatusOverlayResponse = z.infer<typeof statusOverlayResponseSchema>

export type SortBy = "name" | "date"
export type SortDirection = "asc" | "desc"
export type TypeFilter = "all" | "file" | "folder"
