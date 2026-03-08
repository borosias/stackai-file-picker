import fs from "node:fs"
import path from "node:path"
import postgres from "postgres"

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return
  }

  const file = fs.readFileSync(envPath, "utf8")

  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) {
      continue
    }

    const separatorIndex = line.indexOf("=")
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    if (!key || key in process.env) {
      continue
    }

    let value = line.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    process.env[key] = value
  }
}

function loadLocalEnvironment() {
  const cwd = process.cwd()
  loadEnvFile(path.join(cwd, ".env.local"))
  loadEnvFile(path.join(cwd, ".env"))
}

async function main() {
  loadLocalEnvironment()

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Add it to your shell environment or .env.local before running `npm run db:setup`.",
    )
  }

  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 1,
  })

  try {
    await sql.unsafe(`
      create table if not exists hidden_resources (
        connection_id text not null,
        resource_id text not null,
        resource_path text not null,
        hidden_at timestamptz not null default now(),
        restored_at timestamptz null,
        primary key (connection_id, resource_id)
      )
    `)

    console.log("hidden_resources schema is ready.")
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
