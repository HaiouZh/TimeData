import type { MiddlewareHandler } from "hono";
import type { z } from "zod";

type QueryEnv<Data> = {
  Variables: {
    query: Data;
  };
};

type BodyEnv<Data> = {
  Variables: {
    body: Data;
  };
};

function validationError(code: string, message: string, details?: unknown) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function validateQuery<Schema extends z.ZodType>(schema: Schema): MiddlewareHandler<QueryEnv<z.output<Schema>>> {
  return async (c, next) => {
    const parsed = schema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) {
      return c.json(validationError("INVALID_REQUEST", "Invalid query", { issues: parsed.error.issues }), 400);
    }

    c.set("query", parsed.data);
    await next();
  };
}

export function validateBody<Schema extends z.ZodType>(schema: Schema): MiddlewareHandler<BodyEnv<z.output<Schema>>> {
  return async (c, next) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(validationError("INVALID_JSON", "Request body must be valid JSON"), 400);
    }

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return c.json(validationError("INVALID_BODY", "Invalid request body", { issues: parsed.error.issues }), 400);
    }

    c.set("body", parsed.data);
    await next();
  };
}
