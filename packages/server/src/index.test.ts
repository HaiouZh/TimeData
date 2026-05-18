import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalAuthToken = process.env.AUTH_TOKEN;
const originalNodeEnv = process.env.NODE_ENV;
const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;

beforeEach(() => {
  vi.resetModules();
  process.env.NODE_ENV = "production";
  process.env.AUTH_TOKEN = "secret";
  process.env.ALLOWED_ORIGINS = "https://app.example.com";
  vi.doMock("./db/schema.js", () => ({ initializeDatabase: vi.fn() }));
  vi.doMock("./db/utcReset.js", () => ({ runUtcResetIfNeeded: vi.fn(() => ({ ran: false })) }));
  vi.doMock("@hono/node-server", () => ({ serve: vi.fn() }));
  vi.doMock("@hono/node-server/serve-static", () => ({
    serveStatic: vi.fn(() => async (_c: any, next: () => Promise<void>) => {
      await next();
    }),
  }));
  vi.doMock("./lib/version.js", () => ({
    getVersionInfo: vi.fn(async () => ({
      current: "dev",
      latest: "dev",
      hasUpdate: false,
      checkedAt: "2026-05-13T00:00:00.000Z",
    })),
  }));
});

afterEach(() => {
  vi.doUnmock("./db/schema.js");
  vi.doUnmock("./db/utcReset.js");
  vi.doUnmock("@hono/node-server");
  vi.doUnmock("@hono/node-server/serve-static");
  vi.doUnmock("./lib/version.js");
  vi.restoreAllMocks();

  if (originalAuthToken === undefined) {
    delete process.env.AUTH_TOKEN;
  } else {
    process.env.AUTH_TOKEN = originalAuthToken;
  }

  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }

  if (originalAllowedOrigins === undefined) {
    delete process.env.ALLOWED_ORIGINS;
  } else {
    process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
  }
});

describe("server app middleware order", () => {
  it("rejects production startup without AUTH_TOKEN", async () => {
    delete process.env.AUTH_TOKEN;

    await expect(import("./index.js")).rejects.toThrow("AUTH_TOKEN must be set when NODE_ENV=production");
  }, 10_000);

  it("leaves health and version public while protecting later API routes", async () => {
    const { default: app } = await import("./index.js");

    expect((await app.request("/api/health")).status).toBe(200);
    expect((await app.request("/api/version")).status).toBe(200);
    expect((await app.request("/api/categories")).status).toBe(401);
    expect(
      (
        await app.request("/api/categories", {
          headers: { Authorization: "Bearer secret" },
        })
      ).status,
    ).not.toBe(401);
  });

  it("applies the configured CORS allowlist to protected API preflight requests", async () => {
    const { default: app } = await import("./index.js");

    const allowed = await app.request("/api/categories", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");

    const blocked = await app.request("/api/categories", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(blocked.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
