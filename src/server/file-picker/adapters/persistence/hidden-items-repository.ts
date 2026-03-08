import postgres from "postgres"

export interface HiddenItemRecord {
  connectionId: string
  resourceId: string
  resourcePath: string
}

export interface HiddenItemsRepository {
  getHiddenResourceIds(
    connectionId: string,
    resourceIds: readonly string[],
  ): Promise<Set<string>>
  hideItem(record: HiddenItemRecord): Promise<void>
  restoreItem(connectionId: string, resourceId: string): Promise<void>
}

type SqlClient = ReturnType<typeof postgres>

const clients = new Map<string, SqlClient>()

function getClient(databaseUrl: string): SqlClient {
  const cached = clients.get(databaseUrl)
  if (cached) {
    return cached
  }

  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 1,
  })

  clients.set(databaseUrl, sql)
  return sql
}

function isMissingHiddenResourcesTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  )
}

function throwSchemaSetupError(): never {
  throw new Error(
    "Database schema is missing for hidden_resources. Run `npm run db:setup` before starting the app.",
  )
}

async function runHiddenResourcesQuery<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isMissingHiddenResourcesTableError(error)) {
      throwSchemaSetupError()
    }

    throw error
  }
}

export function createPostgresHiddenItemsRepository(
  databaseUrl: string,
): HiddenItemsRepository {
  const sql = getClient(databaseUrl)

  return {
    async getHiddenResourceIds(connectionId, resourceIds) {
      if (resourceIds.length === 0) {
        return new Set()
      }

      const rows = await runHiddenResourcesQuery(() =>
        sql<{ resource_id: string }[]>`
          select resource_id
          from hidden_resources
          where connection_id = ${connectionId}
            and restored_at is null
            and resource_id in ${sql(resourceIds)}
        `,
      )

      return new Set(rows.map((row) => row.resource_id))
    },
    async hideItem(record) {
      await runHiddenResourcesQuery(() =>
        sql`
          insert into hidden_resources (
            connection_id,
            resource_id,
            resource_path,
            hidden_at,
            restored_at
          ) values (
            ${record.connectionId},
            ${record.resourceId},
            ${record.resourcePath},
            now(),
            null
          )
          on conflict (connection_id, resource_id)
          do update set
            resource_path = excluded.resource_path,
            hidden_at = now(),
            restored_at = null
        `,
      )
    },
    async restoreItem(connectionId, resourceId) {
      await runHiddenResourcesQuery(() =>
        sql`
          update hidden_resources
          set restored_at = now()
          where connection_id = ${connectionId}
            and resource_id = ${resourceId}
            and restored_at is null
        `,
      )
    },
  }
}

export function createInMemoryHiddenItemsRepository(
  initialRecords: readonly HiddenItemRecord[] = [],
): HiddenItemsRepository & {
  dump(): HiddenItemRecord[]
} {
  const records = new Map<string, HiddenItemRecord>()

  for (const record of initialRecords) {
    records.set(`${record.connectionId}:${record.resourceId}`, record)
  }

  return {
    async getHiddenResourceIds(connectionId, resourceIds) {
      return new Set(
        resourceIds.filter((resourceId) =>
          records.has(`${connectionId}:${resourceId}`),
        ),
      )
    },
    async hideItem(record) {
      records.set(`${record.connectionId}:${record.resourceId}`, record)
    },
    async restoreItem(connectionId, resourceId) {
      records.delete(`${connectionId}:${resourceId}`)
    },
    dump() {
      return [...records.values()]
    },
  }
}
