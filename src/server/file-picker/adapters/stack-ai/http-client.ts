import type { FilePickerConfig } from "@/server/file-picker/config"
import { FilePickerServerError } from "@/server/file-picker/errors"

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE"
type QueryValue = string | string[] | undefined

interface TokenCacheEntry {
  token: string
  expiresAt: number
}

let tokenCache: TokenCacheEntry | undefined

function toUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (typeof payload === "string" && payload.trim()) {
    return payload
  }

  if (typeof payload !== "object" || payload === null) {
    return undefined
  }

  const record = payload as Record<string, unknown>
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error
  }
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message
  }
  if (typeof record.detail === "string" && record.detail.trim()) {
    return record.detail
  }

  return undefined
}

async function readPayload(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) {
    return null
  }

  const text = await response.text()
  if (!text.trim()) {
    return null
  }

  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  return text
}

async function authenticate(config: FilePickerConfig): Promise<string> {
  if (config.accessToken) {
    return config.accessToken
  }

  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token
  }

  if (!config.email || !config.password || !config.authAnonKey) {
    throw new FilePickerServerError(
      "Missing Stack AI authentication settings. Provide STACKAI_ACCESS_TOKEN or STACKAI_EMAIL/STACKAI_PASSWORD/STACKAI_AUTH_ANON_KEY.",
      { status: 500, code: "missing_config" },
    )
  }

  const response = await fetch(
    `${config.authBaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Apikey: config.authAnonKey,
      },
      body: JSON.stringify({
        email: config.email,
        password: config.password,
        gotrue_meta_security: {},
      }),
      cache: "no-store",
    },
  )

  const payload = await readPayload(response)
  if (!response.ok) {
    throw new FilePickerServerError(
      extractErrorMessage(payload) ??
        `Failed to authenticate against Stack AI (${response.status}).`,
      { status: response.status, code: "stack_auth_failed" },
    )
  }

  if (typeof payload !== "object" || payload === null) {
    throw new FilePickerServerError("Stack AI auth response did not contain a token.", {
      status: 500,
      code: "stack_auth_failed",
    })
  }

  const record = payload as Record<string, unknown>
  const token =
    typeof record.access_token === "string" && record.access_token.trim()
      ? record.access_token
      : undefined

  if (!token) {
    throw new FilePickerServerError("Stack AI auth response did not contain access_token.", {
      status: 500,
      code: "stack_auth_failed",
    })
  }

  const expiresIn =
    typeof record.expires_in === "number"
      ? record.expires_in
      : typeof record.expires_in === "string"
        ? Number(record.expires_in)
        : 3600

  tokenCache = {
    token,
    expiresAt: Date.now() + Math.max(60, (Number.isFinite(expiresIn) ? expiresIn : 3600) - 60) * 1000,
  }

  return token
}

async function executeRequest(
  config: FilePickerConfig,
  token: string,
  args: {
    method: HttpMethod
    path: string
    query?: Record<string, QueryValue>
    body?: unknown
  },
): Promise<{ response: Response; payload: unknown }> {
  const url = new URL(toUrl(config.apiBaseUrl, args.path))

  for (const [key, value] of Object.entries(args.query ?? {})) {
    if (!value) {
      continue
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry) {
          url.searchParams.append(key, entry)
        }
      }
      continue
    }

    url.searchParams.set(key, value)
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }

  let body: string | undefined
  if (args.body !== undefined) {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify(args.body)
  }

  const response = await fetch(url, {
    method: args.method,
    headers,
    body,
    cache: "no-store",
  })

  return {
    response,
    payload: await readPayload(response),
  }
}

export async function stackRequest(
  config: FilePickerConfig,
  args: {
    method: HttpMethod
    path: string
    query?: Record<string, QueryValue>
    body?: unknown
  },
): Promise<unknown> {
  const token = await authenticate(config)
  let { response, payload } = await executeRequest(config, token, args)

  if (!config.accessToken && response.status === 401) {
    tokenCache = undefined
    const refreshedToken = await authenticate(config)
    const retried = await executeRequest(config, refreshedToken, args)
    response = retried.response
    payload = retried.payload
  }

  if (response.ok) {
    return payload
  }

  throw new FilePickerServerError(
    extractErrorMessage(payload) ??
      `Stack AI request failed with status ${response.status}.`,
    {
      status: response.status,
      code: "stack_request_failed",
    },
  )
}
