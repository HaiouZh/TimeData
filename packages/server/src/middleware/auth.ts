import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

const AUTH_UNSET_WARNING =
  "[auth] AUTH_TOKEN unset — all /api/* endpoints are open. Do NOT use in production.";

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

export function assertProductionAuthConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production" && !env.AUTH_TOKEN) {
    throw new Error("AUTH_TOKEN must be set when NODE_ENV=production");
  }
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const token = process.env.AUTH_TOKEN;
  if (!token) {
    if (!hasWarnedAuthUnset) {
      console.warn(AUTH_UNSET_WARNING);
      hasWarnedAuthUnset = true;
    }
    await next();
    return;
  }

  if (!bearerTokenMatches(c.req.header("Authorization"), token)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
};
