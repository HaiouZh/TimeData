import type { MiddlewareHandler } from "hono";

function payloadTooLarge(maxBytes: number) {
  return {
    error: "payload_too_large",
    message: `Request body exceeds the ${maxBytes}-byte limit.`,
    limit: maxBytes,
  };
}

export function bodyLimit(maxBytes: number): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") {
      await next();
      return;
    }

    const lengthHeader = c.req.header("Content-Length");
    if (lengthHeader) {
      const length = Number.parseInt(lengthHeader, 10);
      if (Number.isFinite(length)) {
        if (length > maxBytes) {
          return c.json(payloadTooLarge(maxBytes), 413);
        }
        await next();
        return;
      }
    }

    const cloned = c.req.raw.clone();
    const reader = cloned.body?.getReader();
    if (reader) {
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          void reader.cancel();
          return c.json(payloadTooLarge(maxBytes), 413);
        }
      }
    }

    await next();
  };
}
