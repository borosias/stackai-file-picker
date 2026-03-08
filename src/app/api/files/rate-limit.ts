import { NextRequest, NextResponse } from "next/server"

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_KEYS = 1000
const RATE_LIMIT_MAX_REQUESTS = Number(
  process.env.API_RATE_LIMIT_MAX_REQUESTS ?? "120",
)
const EXPLICIT_RATE_LIMIT_BACKEND = process.env.API_RATE_LIMIT_BACKEND
  ?.trim()
  .toLowerCase()

interface RateLimitBucket {
  count: number
  resetAt: number
}

export type RateLimitBackend = "off" | "memory" | "upstash"

const inMemoryRateLimitBuckets = new Map<string, RateLimitBucket>()
const warnedMessages = new Set<string>()

function getClientKey(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for")
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim()
    if (firstIp) {
      return firstIp
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim()
  if (realIp) {
    return realIp
  }

  return "local"
}

function cleanupInMemoryBuckets(now: number): void {
  for (const [key, bucket] of inMemoryRateLimitBuckets) {
    if (bucket.resetAt <= now) {
      inMemoryRateLimitBuckets.delete(key)
    }
  }

  while (inMemoryRateLimitBuckets.size > RATE_LIMIT_MAX_KEYS) {
    const oldestKey = inMemoryRateLimitBuckets.keys().next().value
    if (!oldestKey) {
      break
    }
    inMemoryRateLimitBuckets.delete(oldestKey)
  }
}

function warnOnce(message: string): void {
  if (warnedMessages.has(message)) {
    return
  }

  warnedMessages.add(message)
  console.warn(message)
}

function tooManyRequestsResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Please retry shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
      },
    },
  )
}

function readPipelineResult(entry: unknown): unknown {
  if (
    typeof entry === "object" &&
    entry !== null &&
    "result" in entry
  ) {
    return (entry as { result: unknown }).result
  }

  return entry
}

async function enforceDistributedRateLimit(
  clientKey: string,
  now: number,
): Promise<NextResponse | null> {
  const redisRestUrl = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const redisRestToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!redisRestUrl || !redisRestToken) {
    return null
  }

  const bucketSlot = Math.floor(now / RATE_LIMIT_WINDOW_MS)
  const bucketKey = `ratelimit:api:files:${clientKey}:${bucketSlot}`

  try {
    const response = await fetch(`${redisRestUrl.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisRestToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", bucketKey],
        ["PEXPIRE", bucketKey, String(RATE_LIMIT_WINDOW_MS), "NX"],
        ["PTTL", bucketKey],
      ]),
      cache: "no-store",
    })

    if (!response.ok) {
      return null
    }

    const payload = await response.json().catch(() => null)
    if (!Array.isArray(payload) || payload.length < 3) {
      return null
    }

    const countValue = readPipelineResult(payload[0])
    const ttlValue = readPipelineResult(payload[2])
    const count = Number(countValue)
    const ttlMs = Number(ttlValue)

    if (!Number.isFinite(count)) {
      return null
    }

    if (count <= RATE_LIMIT_MAX_REQUESTS) {
      return null
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : RATE_LIMIT_WINDOW_MS) / 1000),
    )
    return tooManyRequestsResponse(retryAfterSeconds)
  } catch {
    return null
  }
}

function enforceInMemoryRateLimit(clientKey: string, now: number): NextResponse | null {
  cleanupInMemoryBuckets(now)

  const existing = inMemoryRateLimitBuckets.get(clientKey)
  if (!existing || existing.resetAt <= now) {
    inMemoryRateLimitBuckets.set(clientKey, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    })
    return null
  }

  existing.count += 1
  inMemoryRateLimitBuckets.delete(clientKey)
  inMemoryRateLimitBuckets.set(clientKey, existing)

  if (existing.count <= RATE_LIMIT_MAX_REQUESTS) {
    return null
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((existing.resetAt - now) / 1000),
  )
  return tooManyRequestsResponse(retryAfterSeconds)
}

function hasUpstashConfig(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  )
}

export function resolveRateLimitBackend(): RateLimitBackend {
  if (EXPLICIT_RATE_LIMIT_BACKEND === "off") {
    return "off"
  }

  if (EXPLICIT_RATE_LIMIT_BACKEND === "memory") {
    return "memory"
  }

  if (EXPLICIT_RATE_LIMIT_BACKEND === "upstash") {
    if (hasUpstashConfig()) {
      return "upstash"
    }

    warnOnce(
      "[rate-limit] API_RATE_LIMIT_BACKEND=upstash but Upstash credentials are missing. Rate limiting is disabled.",
    )
    return "off"
  }

  if (hasUpstashConfig()) {
    return "upstash"
  }

  if (process.env.NODE_ENV === "production") {
    warnOnce(
      "[rate-limit] Upstash is not configured in production. Rate limiting is disabled. Set API_RATE_LIMIT_BACKEND=memory to opt into per-instance fallback.",
    )
    return "off"
  }

  return "memory"
}

export async function enforceApiRateLimit(
  request: NextRequest,
): Promise<NextResponse | null> {
  if (!Number.isFinite(RATE_LIMIT_MAX_REQUESTS) || RATE_LIMIT_MAX_REQUESTS <= 0) {
    return null
  }

  const now = Date.now()
  const clientKey = getClientKey(request)
  const backend = resolveRateLimitBackend()

  if (backend === "off") {
    return null
  }

  if (backend === "upstash") {
    return enforceDistributedRateLimit(clientKey, now)
  }

  if (process.env.NODE_ENV === "production") {
    warnOnce(
      "[rate-limit] Using per-instance in-memory rate limiting in production because API_RATE_LIMIT_BACKEND=memory is explicitly enabled.",
    )
  }

  return enforceInMemoryRateLimit(clientKey, now)
}
