import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

const AUTH_DEV_BYPASS_WARNING =
  "[auth] AUTH_TOKEN unset — all /api/* endpoints are open. ALLOW_UNAUTHENTICATED_DEV=1 is set.";

let hasWarnedAuthUnset = false;

function bearerTokenMatches(authHeader: string | undefined, token: string): boolean {
  if (!authHeader) {
    return false;
  }

  const provided = Buffer.from(authHeader);
  const expected = Buffer.from(`Bearer ${token}`);

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}

export interface AuthAuditLogger {
  recordAuthFailure?: (event: { path: string; ip?: string }) => void;
}

export function createAuthMiddleware(audit?: AuthAuditLogger): MiddlewareHandler {
  return async (c, next) => {
    const token = process.env.AUTH_TOKEN;
    if (!token) {
      if (process.env.ALLOW_UNAUTHENTICATED_DEV !== "1") {
        return c.json({ error: "Server misconfigured: AUTH_TOKEN not set" }, 500);
      }
      if (!hasWarnedAuthUnset) {
        console.warn(AUTH_DEV_BYPASS_WARNING);
        hasWarnedAuthUnset = true;
      }
      await next();
      return;
    }

    if (!bearerTokenMatches(c.req.header("Authorization"), token)) {
      audit?.recordAuthFailure?.({ path: c.req.path, ip: c.req.header("X-Forwarded-For") || undefined });
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
  };
}

export const authMiddleware = createAuthMiddleware();
