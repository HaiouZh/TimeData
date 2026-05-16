import type { MiddlewareHandler } from "hono";

interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests per window per identifier. */
  max: number;
  /**
   * Identifier extractor. Defaults to `Authorization` header (so a single token
   * shares a quota across IPs) falling back to the `X-Forwarded-For` chain and
   * then `c.req.raw.headers.get("x-real-ip")`.
   */
  identify?: (c: Parameters<MiddlewareHandler>[0]) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window rate limit middleware. In-memory: single-instance only.
 *
 * For multi-instance deployments, switch to a SQLite-backed store keyed on the
 * same identifier; the contract (`max` / `windowMs`) and 429 response shape are
 * intentionally simple so the storage swap stays mechanical.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const { windowMs, max, identify } = options;
  const buckets = new Map<string, Bucket>();

  return async (c, next) => {
    const id = identify ? identify(c) : defaultIdentifier(c);
    const now = Date.now();
    const bucket = buckets.get(id);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(id, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    if (bucket.count >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      c.header("Retry-After", String(retryAfterSec));
      return c.json(
        {
          error: "rate_limited",
          message: `Too many requests. Retry after ${retryAfterSec}s.`,
          retryAfterSec,
        },
        429,
      );
    }

    bucket.count += 1;
    await next();
  };
}

function defaultIdentifier(c: Parameters<MiddlewareHandler>[0]): string {
  const auth = c.req.header("Authorization");
  if (auth) return `auth:${auth}`;
  const forwarded = c.req.header("X-Forwarded-For");
  if (forwarded) return `xff:${forwarded.split(",")[0]?.trim() ?? forwarded}`;
  const realIp = c.req.header("X-Real-IP");
  if (realIp) return `ip:${realIp}`;
  return "anonymous";
}
