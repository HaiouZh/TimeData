import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * 这张表是 `errorJson` 的码域，**不是服务端全部错误响应的码域**——错误形态按路由分组，
 * 不是全局统一的（分布见 `docs/evergreen/architecture.md`）。表里有三个成员没有服务端
 * `errorJson` 调用点，但都不是可以随手删的死码：
 *
 * - `UNAUTHORIZED` / `RATE_LIMITED`：语义真实存在，但由 `middleware/auth.ts`（裸
 *   `{error:"Unauthorized"}`）与 `middleware/rateLimit.ts`（`{error:"rate_limited",retryAfterSec}`）
 *   用各自的响应形状承载，没走这里。要统一形态时从这两处改起。
 * - `INVALID_DATE`：服务端不产生，CLI 侧（`cli/src/lib/validation.ts`）用同名码，
 *   两边靠字符串对齐而非共享类型。
 *
 * 加新码前先确认它会真的经 `errorJson` 发出，否则只是在这张表上再堆一个装饰。
 */
export const ErrorCode = {
  INVALID_BODY: "INVALID_BODY",
  INVALID_JSON: "INVALID_JSON",
  INVALID_DATE: "INVALID_DATE",
  INVALID_REQUEST: "INVALID_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  CONFLICT: "CONFLICT",
  SELF_UPDATE_DISABLED: "SELF_UPDATE_DISABLED",
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
  INTERNAL_ERROR: "Internal error",
  CONFLICT: "Conflict",
  SELF_UPDATE_DISABLED: "Self-update is disabled",
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
