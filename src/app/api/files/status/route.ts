import { NextRequest, NextResponse } from "next/server"

import { enforceApiRateLimit } from "@/app/api/files/rate-limit"
import { statusOverlayRequestSchema } from "@/lib/drive-types"
import {
  getFolderItemStatuses,
  toHttpError,
} from "@/server/file-picker/service"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

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
      { error: "Request body must be valid JSON.", code: "validation_error" },
      { status: 400 },
    )
  }

  const parsed = statusOverlayRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid status payload.", code: "validation_error" },
      { status: 400 },
    )
  }

  try {
    const response = await getFolderItemStatuses(parsed.data)
    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    const httpError = toHttpError(error)
    return NextResponse.json(
      { error: httpError.message, code: httpError.code },
      { status: httpError.status },
    )
  }
}
