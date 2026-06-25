import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

const AUTH_DEV_BYPASS_WARNING =
  "[auth] AUTH_TOKEN unset — all /api/* endpoints are open. ALLOW_UNAUTHENTICATED_DEV=1 is set.";
const SCOPED_AUTH_DEV_BYPASS_WARNING =
  "[auth] AUTH_TOKEN and AGENT_TOKEN unset — scoped endpoints are open. ALLOW_UNAUTHENTICATED_DEV=1 is set.";

let hasWarnedAuthUnset = false;
let hasWarnedScopedAuthUnset = false;

export type AuthTokenTier = "public" | "master" | "agent" | "dev_bypass" | "missing" | "invalid" | "unknown";
export const TOKEN_TIER_CONTEXT_KEY = "tokenTier";

function bearerTokenMatches(authHeader: string | undefined, token: string): boolean {
  if (!authHeader) {
    return false;
  }

  const providedHash = createHash("sha256")
    .update(authHeader, "utf8")
    .digest();
  const expectedHash = createHash("sha256")
    .update(`Bearer ${token}`, "utf8")
    .digest();
  // Both are 32-byte sha256 digests, equal length — no length side-channel
  return timingSafeEqual(providedHash, expectedHash);
}

function configuredTokens(tokens: Array<string | undefined>): string[] {
  return tokens.filter((token): token is string => typeof token === "string" && token.length > 0);
}

function bearerTokenMatchesAny(authHeader: string | undefined, tokens: string[]): boolean {
  let matchesAnyToken = false;

  for (const token of tokens) {
    const matchesToken = bearerTokenMatches(authHeader, token);
    matchesAnyToken = matchesAnyToken || matchesToken;
  }

  return matchesAnyToken;
}

function bearerTokenTier(
  authHeader: string | undefined,
  tokens: Array<{ token: string; tier: AuthTokenTier }>,
): AuthTokenTier | null {
  let matchedTier: AuthTokenTier | null = null;

  for (const candidate of tokens) {
    const matchesToken = bearerTokenMatches(authHeader, candidate.token);
    if (matchesToken && matchedTier === null) matchedTier = candidate.tier;
  }

  return matchedTier;
}

function recordAuthFailure(audit: AuthAuditLogger | undefined, path: string, ip?: string): void {
  audit?.recordAuthFailure?.({ path, ip });
}

export interface AuthAuditLogger {
  recordAuthFailure?: (event: { path: string; ip?: string }) => void;
}

export function createAuthMiddleware(audit?: AuthAuditLogger): MiddlewareHandler {
  return async (c, next) => {
    const tokens = configuredTokens([process.env.AUTH_TOKEN]);
    if (tokens.length === 0) {
      if (process.env.ALLOW_UNAUTHENTICATED_DEV !== "1") {
        return c.json({ error: "Server misconfigured: AUTH_TOKEN not set" }, 500);
      }
      if (!hasWarnedAuthUnset) {
        console.warn(AUTH_DEV_BYPASS_WARNING);
        hasWarnedAuthUnset = true;
      }
      c.set(TOKEN_TIER_CONTEXT_KEY, "dev_bypass");
      await next();
      return;
    }

    const authHeader = c.req.header("Authorization");
    if (!bearerTokenMatchesAny(authHeader, tokens)) {
      c.set(TOKEN_TIER_CONTEXT_KEY, authHeader ? "invalid" : "missing");
      recordAuthFailure(audit, c.req.path, c.req.header("X-Forwarded-For") || undefined);
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set(TOKEN_TIER_CONTEXT_KEY, "master");
    await next();
  };
}

export const authMiddleware = createAuthMiddleware();

export function createScopedAuthMiddleware(audit?: AuthAuditLogger): MiddlewareHandler {
  return async (c, next) => {
    const tokens = configuredTokens([process.env.AUTH_TOKEN, process.env.AGENT_TOKEN]);
    if (tokens.length === 0) {
      if (process.env.ALLOW_UNAUTHENTICATED_DEV !== "1") {
        return c.json({ error: "Server misconfigured: AUTH_TOKEN and AGENT_TOKEN not set" }, 500);
      }
      if (!hasWarnedScopedAuthUnset) {
        console.warn(SCOPED_AUTH_DEV_BYPASS_WARNING);
        hasWarnedScopedAuthUnset = true;
      }
      c.set(TOKEN_TIER_CONTEXT_KEY, "dev_bypass");
      await next();
      return;
    }

    const authHeader = c.req.header("Authorization");
    const matchedTier = bearerTokenTier(authHeader, [
      ...configuredTokens([process.env.AUTH_TOKEN]).map((token) => ({ token, tier: "master" as const })),
      ...configuredTokens([process.env.AGENT_TOKEN]).map((token) => ({ token, tier: "agent" as const })),
    ]);
    if (!matchedTier) {
      c.set(TOKEN_TIER_CONTEXT_KEY, authHeader ? "invalid" : "missing");
      recordAuthFailure(audit, c.req.path, c.req.header("X-Forwarded-For") || undefined);
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set(TOKEN_TIER_CONTEXT_KEY, matchedTier);
    await next();
  };
}

export const scopedAuthMiddleware = createScopedAuthMiddleware();
