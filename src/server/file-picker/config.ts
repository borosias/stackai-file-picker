import { FilePickerServerError } from "@/server/file-picker/errors"

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new FilePickerServerError(`Missing ${name}.`, {
      status: 500,
      code: "missing_config",
    })
  }

  return value
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export interface FilePickerConfig {
  apiBaseUrl: string
  authBaseUrl: string
  authAnonKey?: string
  accessToken?: string
  email?: string
  password?: string
  connectionId: string
  knowledgeBaseId?: string
  databaseUrl: string
}

let configCache:
  | {
      signature: string
      value: FilePickerConfig
    }
  | undefined

function getSignature(): string {
  return JSON.stringify({
    apiBaseUrl: process.env.STACKAI_API_BASE_URL ?? "",
    authBaseUrl: process.env.STACKAI_AUTH_BASE_URL ?? "",
    authAnonKey: process.env.STACKAI_AUTH_ANON_KEY ?? "",
    accessToken: process.env.STACKAI_ACCESS_TOKEN ?? "",
    email: process.env.STACKAI_EMAIL ?? "",
    password: process.env.STACKAI_PASSWORD ?? "",
    connectionId: process.env.STACKAI_CONNECTION_ID ?? "",
    knowledgeBaseId: process.env.STACKAI_KNOWLEDGE_BASE_ID ?? "",
    databaseUrl: process.env.DATABASE_URL ?? "",
  })
}

export function getFilePickerConfig(): FilePickerConfig {
  const signature = getSignature()

  if (
    configCache &&
    configCache.signature === signature &&
    process.env.NODE_ENV !== "test" &&
    process.env.VITEST !== "true"
  ) {
    return configCache.value
  }

  const value: FilePickerConfig = {
    apiBaseUrl: readRequiredEnv("STACKAI_API_BASE_URL"),
    authBaseUrl: readRequiredEnv("STACKAI_AUTH_BASE_URL"),
    authAnonKey: readOptionalEnv("STACKAI_AUTH_ANON_KEY"),
    accessToken: readOptionalEnv("STACKAI_ACCESS_TOKEN"),
    email: readOptionalEnv("STACKAI_EMAIL"),
    password: readOptionalEnv("STACKAI_PASSWORD"),
    connectionId: readRequiredEnv("STACKAI_CONNECTION_ID"),
    knowledgeBaseId: readOptionalEnv("STACKAI_KNOWLEDGE_BASE_ID"),
    databaseUrl: readRequiredEnv("DATABASE_URL"),
  }

  configCache = {
    signature,
    value,
  }

  return value
}
