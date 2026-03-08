export class FilePickerServerError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message)
    this.name = "FilePickerServerError"
    this.status = options?.status ?? 500
    this.code = options?.code ?? "internal_error"
  }
}

export function toHttpError(error: unknown): {
  status: number
  code: string
  message: string
} {
  if (error instanceof FilePickerServerError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
    }
  }

  if (error instanceof Error) {
    return {
      status: 500,
      code: "internal_error",
      message: error.message,
    }
  }

  return {
    status: 500,
    code: "internal_error",
    message: "Unknown server error.",
  }
}
