import postgres from "postgres"

export interface KbOverridesRepository {
  getKnowledgeBaseId(connectionId: string): Promise<string | undefined>
  setKnowledgeBaseId(connectionId: string, knowledgeBaseId: string): Promise<void>
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

function isMissingTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  )
}

export function createPostgresKbOverridesRepository(
  databaseUrl: string,
): KbOverridesRepository {
  const sql = getClient(databaseUrl)

  return {
    async getKnowledgeBaseId(connectionId) {
      try {
        const rows = await sql<{ knowledge_base_id: string }[]>`
          select knowledge_base_id
          from kb_overrides
          where connection_id = ${connectionId}
        `
        return rows[0]?.knowledge_base_id
      } catch (error) {
        if (isMissingTableError(error)) {
          return undefined
        }
        throw error
      }
    },

    async setKnowledgeBaseId(connectionId, knowledgeBaseId) {
      try {
        await sql`
          insert into kb_overrides (connection_id, knowledge_base_id, created_at)
          values (${connectionId}, ${knowledgeBaseId}, now())
          on conflict (connection_id)
          do update set
            knowledge_base_id = ${knowledgeBaseId},
            created_at = now()
        `
      } catch (error) {
        if (isMissingTableError(error)) {
          return
        }
        throw error
      }
    },
  }
}
