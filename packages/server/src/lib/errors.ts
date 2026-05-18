import type { ContentfulStatusCode } from "hono/utils/http-status";

export const ErrorCode = {
  INVALID_BODY: "INVALID_BODY",
  INVALID_JSON: "INVALID_JSON",
  INVALID_DATE: "INVALID_DATE",
  INVALID_REQUEST: "INVALID_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  RATE_LIMITED: "RATE_LIMITED",
  CORS_DENIED: "CORS_DENIED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  CONFLICT: "CONFLICT",
  NOT_FOUND: "NOT_FOUND",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  INVALID_BODY: "Invalid request body",
  INVALID_JSON: "Request body must be valid JSON",
  INVALID_DATE: "Invalid date",
  INVALID_REQUEST: "Invalid request",
  UNAUTHORIZED: "Unauthorized",
  RATE_LIMITED: "Too many requests",
  CORS_DENIED: "Origin not allowed",
  INTERNAL_ERROR: "Internal error",
  CONFLICT: "Conflict",
  NOT_FOUND: "Not found",
};

export interface ErrorBody {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export function errorJson(
  code: ErrorCode,
  status: ContentfulStatusCode,
  message?: string,
  details?: unknown,
): { body: ErrorBody; status: ContentfulStatusCode } {
  const body: ErrorBody = {
    ok: false,
    error: { code, message: message ?? DEFAULT_MESSAGE[code] },
  };
  if (details !== undefined) body.error.details = details;
  return { body, status };
}
