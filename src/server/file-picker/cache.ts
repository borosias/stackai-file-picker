import type { SourceDescriptor } from "@/server/file-picker/domain"
import type { KnowledgeBaseDetails } from "@/server/file-picker/adapters/stack-ai/knowledge-bases-gateway"

const KB_DETAILS_CACHE_TTL_MS = 2_000
const RESOLVED_FOLDER_SOURCES_CACHE_TTL_MS = 10_000

interface TtlCacheEntry<T> {
  expiresAt: number
  value: T
}

const knowledgeBaseDetailsCache = new Map<string, TtlCacheEntry<KnowledgeBaseDetails>>()
const resolvedFolderSourcesCache = new Map<string, TtlCacheEntry<SourceDescriptor[]>>()

function readTtlCache<T>(
  cache: Map<string, TtlCacheEntry<T>>,
  key: string,
): T | undefined {
  const entry = cache.get(key)
  if (!entry) {
    return undefined
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return undefined
  }

  return entry.value
}

function writeTtlCache<T>(
  cache: Map<string, TtlCacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
): T {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  })

  return value
}

function buildResolvedFolderSourcesCacheKey(
  knowledgeBaseId: string,
  sourceIds: readonly string[],
): string {
  return `${knowledgeBaseId}:${[...sourceIds].sort().join(",")}`
}

export function readCachedKnowledgeBaseDetails(
  knowledgeBaseId: string,
): KnowledgeBaseDetails | undefined {
  return readTtlCache(knowledgeBaseDetailsCache, knowledgeBaseId)
}

export function writeCachedKnowledgeBaseDetails(
  knowledgeBaseId: string,
  details: KnowledgeBaseDetails,
): KnowledgeBaseDetails {
  return writeTtlCache(
    knowledgeBaseDetailsCache,
    knowledgeBaseId,
    details,
    KB_DETAILS_CACHE_TTL_MS,
  )
}

export function readCachedResolvedFolderSources(args: {
  knowledgeBaseId: string
  sourceIds: readonly string[]
}): SourceDescriptor[] | undefined {
  return readTtlCache(
    resolvedFolderSourcesCache,
    buildResolvedFolderSourcesCacheKey(args.knowledgeBaseId, args.sourceIds),
  )
}

export function writeCachedResolvedFolderSources(args: {
  knowledgeBaseId: string
  sourceIds: readonly string[]
  sources: SourceDescriptor[]
}): SourceDescriptor[] {
  return writeTtlCache(
    resolvedFolderSourcesCache,
    buildResolvedFolderSourcesCacheKey(args.knowledgeBaseId, args.sourceIds),
    args.sources,
    RESOLVED_FOLDER_SOURCES_CACHE_TTL_MS,
  )
}

export function invalidateKnowledgeBaseCaches(knowledgeBaseId: string): void {
  knowledgeBaseDetailsCache.delete(knowledgeBaseId)

  for (const key of resolvedFolderSourcesCache.keys()) {
    if (key.startsWith(`${knowledgeBaseId}:`)) {
      resolvedFolderSourcesCache.delete(key)
    }
  }
}

export function resetKnowledgeBaseCachesForTests(): void {
  knowledgeBaseDetailsCache.clear()
  resolvedFolderSourcesCache.clear()
}
