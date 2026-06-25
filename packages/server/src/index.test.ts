import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalAuthToken = process.env.AUTH_TOKEN;
const originalAgentToken = process.env.AGENT_TOKEN;
const originalNodeEnv = process.env.NODE_ENV;
const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;

beforeEach(() => {
  vi.resetModules();
  process.env.NODE_ENV = "production";
  process.env.AUTH_TOKEN = "secret";
  process.env.AGENT_TOKEN = "agent-secret";
  process.env.ALLOWED_ORIGINS = "https://app.example.com";
  vi.doMock("./db/schema.js", () => ({ initializeDatabase: vi.fn() }));
  vi.doMock("./db/connection.js", () => ({
    getDb: vi.fn(() => ({
      prepare: vi.fn(() => ({
        all: vi.fn(() => []),
        get: vi.fn(() => ({ ok: 1 })),
      })),
    })),
    getDbPath: vi.fn(() => "/tmp/test-timedata.db"),
  }));
  vi.doMock("./db/utcReset.js", () => ({ runUtcResetIfNeeded: vi.fn(() => ({ ran: false })) }));
  vi.doMock("./sync/backup.js", () => ({ cleanupServerBackups: vi.fn(() => []) }));
  vi.doMock("@hono/node-server", () => ({ serve: vi.fn() }));
  vi.doMock("@hono/node-server/serve-static", () => ({
    serveStatic: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
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
  vi.doUnmock("./db/connection.js");
  vi.doUnmock("./db/utcReset.js");
  vi.doUnmock("./sync/backup.js");
  vi.doUnmock("@hono/node-server");
  vi.doUnmock("@hono/node-server/serve-static");
  vi.doUnmock("./lib/version.js");
  vi.restoreAllMocks();

  if (originalAuthToken === undefined) {
    delete process.env.AUTH_TOKEN;
  } else {
    process.env.AUTH_TOKEN = originalAuthToken;
  }

  if (originalAgentToken === undefined) {
    delete process.env.AGENT_TOKEN;
  } else {
    process.env.AGENT_TOKEN = originalAgentToken;
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

const INDEX_TEST_TIMEOUT_MS = 15_000;

describe("server app middleware order", () => {
  it(
    "keeps production startup available without AUTH_TOKEN and fails closed for protected API routes",
    async () => {
      delete process.env.AUTH_TOKEN;

      const { default: app } = await import("./index.js");

      expect((await app.request("/api/health")).status).toBe(200);
      expect((await app.request("/api/version")).status).toBe(200);
      const protectedResponse = await app.request("/api/categories");
      expect(protectedResponse.status).toBe(500);
      expect(await protectedResponse.json()).toEqual({ error: "Server misconfigured: AUTH_TOKEN not set" });
    },
    INDEX_TEST_TIMEOUT_MS,
  );

  it(
    "leaves health and version public while protecting later API routes",
    async () => {
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
    },
    INDEX_TEST_TIMEOUT_MS,
  );

  it(
    "applies the configured CORS allowlist to protected API preflight requests",
    async () => {
      const { default: app } = await import("./index.js");

      const allowed = await app.request("/api/categories", {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example.com",
          "Access-Control-Request-Method": "GET",
        },
      });
      expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
      expect(allowed.headers.get("Access-Control-Allow-Headers")).toContain("X-Confirm");
      expect(allowed.headers.get("Access-Control-Allow-Headers")).toContain("X-TimeData-Client");

      const blocked = await app.request("/api/categories", {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example.com",
          "Access-Control-Request-Method": "GET",
        },
      });
      expect(blocked.headers.get("Access-Control-Allow-Origin")).toBeNull();
    },
    INDEX_TEST_TIMEOUT_MS,
  );

  it(
    "registers request auditing before auth so unauthorized API requests are logged",
    async () => {
      const { getDb } = await import("./db/connection.js");
      const rows: unknown[] = [];
      vi.mocked(getDb).mockReturnValue({
        prepare: vi.fn((sql: string) => {
          if (sql.includes("SELECT 1 as ok")) return { get: vi.fn(() => ({ ok: 1 })) };
          if (sql.includes("INSERT INTO api_request_logs")) {
            return {
              run: vi.fn((...params: unknown[]) => {
                rows.push(params);
              }),
            };
          }
          if (sql.includes("DELETE FROM api_request_logs")) return { run: vi.fn() };
          return { all: vi.fn(() => []), get: vi.fn(() => undefined), run: vi.fn() };
        }),
      } as never);
      const { default: app } = await import("./index.js");

      const res = await app.request("/api/categories", {
        headers: { "X-TimeData-Client": "web" },
      });

      expect(res.status).toBe(401);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(
        expect.arrayContaining(["GET", "/api/categories", 401, "auth_failed", "missing", null, expect.anything(), "web"]),
      );
    },
    INDEX_TEST_TIMEOUT_MS,
  );

  it(
    "keeps request audit admin endpoint master-only",
    async () => {
      const { getDb } = await import("./db/connection.js");
      vi.mocked(getDb).mockReturnValue({
        prepare: vi.fn((sql: string) => {
          if (sql.includes("SELECT 1 as ok")) return { get: vi.fn(() => ({ ok: 1 })) };
          if (sql.includes("INSERT INTO api_request_logs")) return { run: vi.fn() };
          if (sql.includes("DELETE FROM api_request_logs")) return { run: vi.fn() };
          if (sql.includes("FROM api_request_logs")) {
            return {
              all: vi.fn(() => [{
                id: 1,
                timestamp: "2026-06-25T00:00:00.000Z",
                method: "GET",
                path: "/api/health",
                status: 200,
                outcome: "ok",
                token_tier: "public",
                ip: null,
                user_agent: null,
                client_hint: "web",
                device_label: "web",
                duration_ms: 1,
              }]),
            };
          }
          return { all: vi.fn(() => []), get: vi.fn(() => undefined), run: vi.fn() };
        }),
      } as never);
      const { default: app } = await import("./index.js");

      const agent = await app.request("/api/admin/request-logs", {
        headers: { Authorization: "Bearer agent-secret" },
      });
      const master = await app.request("/api/admin/request-logs", {
        headers: { Authorization: "Bearer secret" },
      });

      expect(agent.status).toBe(401);
      expect(master.status).toBe(200);
      expect(await master.json()).toMatchObject({ limit: 100, logs: [expect.objectContaining({ tokenTier: "public" })] });
    },
    INDEX_TEST_TIMEOUT_MS,
  );
});
