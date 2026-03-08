import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { itemActionSchema, ROOT_FOLDER_ID } from "@/lib/drive-types"
import { enforceApiRateLimit } from "@/app/api/files/rate-limit"
import {
  applyItemAction,
  listFolderItems,
  toHttpError,
} from "@/server/file-picker/service"

const MAX_PAGE_SIZE = 100

const listQuerySchema = z.object({
  parentId: z.string().min(1).default(ROOT_FOLDER_ID),
  parentPath: z.string().trim().min(1).optional(),
  cursor: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1).optional(),
  includeHidden: z
    .enum(["1", "true", "0", "false"])
    .optional()
    .transform((value) => value === "1" || value === "true"),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
})

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rateLimitResponse = await enforceApiRateLimit(request)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsedQuery = listQuerySchema.safeParse({
    parentId: request.nextUrl.searchParams.get("parentId") ?? ROOT_FOLDER_ID,
    parentPath: request.nextUrl.searchParams.get("parentPath") ?? undefined,
    cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
    query: request.nextUrl.searchParams.get("query") ?? undefined,
    pageSize: request.nextUrl.searchParams.get("pageSize") ?? undefined,
    includeHidden: request.nextUrl.searchParams.get("includeHidden") ?? undefined,
  })

  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: "Invalid folder id in query parameters." },
      { status: 400 },
    )
  }

  try {
    const response = await listFolderItems(parsedQuery.data.parentId, {
      parentPath: parsedQuery.data.parentPath,
      cursor: parsedQuery.data.cursor,
      query: parsedQuery.data.query,
      pageSize: parsedQuery.data.pageSize,
      includeHidden: parsedQuery.data.includeHidden,
    })
    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    const httpError = toHttpError(error)
    return NextResponse.json(
      { error: httpError.message, code: httpError.code },
      { status: httpError.status },
    )
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rateLimitResponse = await enforceApiRateLimit(request)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    )
  }

  const parsedBody = itemActionSchema.safeParse(body)
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid action payload." },
      { status: 400 },
    )
  }

  try {
    const response = await applyItemAction(parsedBody.data)
    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    const httpError = toHttpError(error)
    return NextResponse.json(
      { error: httpError.message, code: httpError.code },
      { status: httpError.status },
    )
  }
}
