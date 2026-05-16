import type { MiddlewareHandler } from "hono";

/**
 * Reject requests larger than `maxBytes`.
 *
 * Hono's `c.req.json()` will already buffer the request to memory, so we cap it
 * at the network layer using the `Content-Length` header. Chunked / unknown
 * length requests pass through (they are still bounded by Node's default
 * `maxHttpHeaderSize` for headers and by application-level parsing).
 */
export function bodyLimit(maxBytes: number): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
      await next();
      return;
    }

    const lengthHeader = c.req.header("Content-Length");
    if (lengthHeader) {
      const length = Number.parseInt(lengthHeader, 10);
      if (Number.isFinite(length) && length > maxBytes) {
        return c.json(
          {
            error: "payload_too_large",
            message: `Request body exceeds the ${maxBytes}-byte limit.`,
            limit: maxBytes,
          },
          413,
        );
      }
    }

    await next();
  };
}
