import { afterEach, describe, expect, it, vi } from "vitest"

async function importRateLimitModule() {
  vi.resetModules()
  return import("@/app/api/files/rate-limit")
}

describe("resolveRateLimitBackend", () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it("uses in-memory rate limiting by default outside production", async () => {
    process.env.NODE_ENV = "development"
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.API_RATE_LIMIT_BACKEND

    const rateLimitModule = await importRateLimitModule()

    expect(rateLimitModule.resolveRateLimitBackend()).toBe("memory")
  })

  it("disables rate limiting by default in production without Upstash", async () => {
    process.env.NODE_ENV = "production"
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.API_RATE_LIMIT_BACKEND
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const rateLimitModule = await importRateLimitModule()

    expect(rateLimitModule.resolveRateLimitBackend()).toBe("off")
    expect(warnSpy).toHaveBeenCalled()
  })

  it("uses Upstash in production when configured", async () => {
    process.env.NODE_ENV = "production"
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "token"
    delete process.env.API_RATE_LIMIT_BACKEND

    const rateLimitModule = await importRateLimitModule()

    expect(rateLimitModule.resolveRateLimitBackend()).toBe("upstash")
  })

  it("supports explicit in-memory mode in production", async () => {
    process.env.NODE_ENV = "production"
    process.env.API_RATE_LIMIT_BACKEND = "memory"
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN

    const rateLimitModule = await importRateLimitModule()

    expect(rateLimitModule.resolveRateLimitBackend()).toBe("memory")
  })
})
