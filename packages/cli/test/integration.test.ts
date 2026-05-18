import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2EServer } from "../../server/src/__tests__/e2e/helpers.js";
import { runCli } from "../src/index.js";

type CliOk = { ok: true };
type CliError = { ok: false; error?: { code: string } };
type CliCategories = CliOk & { categories: unknown[] };
type CliEntries = CliOk & { entries: unknown[] };

const TEST_TOKEN = "integration-test-token";
let server: Awaited<ReturnType<typeof startE2EServer>>;

beforeAll(async () => {
  process.env.AUTH_TOKEN = TEST_TOKEN;
  process.env.ALLOWED_ORIGINS = "http://localhost";
  server = await startE2EServer();
}, 30_000);

afterAll(() => {
  server?.close();
  process.env.AUTH_TOKEN = undefined;
  process.env.ALLOWED_ORIGINS = undefined;
});

function makeFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return Response.json({ status: "ok" });
    if (request.headers.get("authorization") !== `Bearer ${TEST_TOKEN}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
    return server.app.request(`${url.pathname}${url.search}`, {
      method: request.method,
      headers: request.headers,
      body,
    });
  };
}

describe("CLI 真实 server-backed 集成", () => {
  it("doctor 通过", async () => {
    const result = await runCli(["doctor", "--server", "http://localhost:3000", "--token", TEST_TOKEN], {
      fetchImpl: makeFetch(),
    }) as CliOk;
    expect(result.ok).toBe(true);
  });

  it("categories 返回默认分类", async () => {
    const result = await runCli(["categories", "--server", "http://localhost:3000", "--token", TEST_TOKEN], {
      fetchImpl: makeFetch(),
    }) as CliCategories;
    expect(result.ok).toBe(true);
    expect(result.categories.length).toBeGreaterThan(0);
  });

  it("list 返回 cli 格式 entries", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = await runCli(["list", "--date", today, "--server", "http://localhost:3000", "--token", TEST_TOKEN], {
      fetchImpl: makeFetch(),
    }) as CliEntries;
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.entries)).toBe(true);
  });

  it("server 返回 401 时失败", async () => {
    const result = await runCli(["categories", "--server", "http://localhost:3000", "--token", "bad"], {
      fetchImpl: makeFetch(),
    }) as CliError;
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("AUTH_FAILED");
  });

  it("无效命令返回 UNKNOWN_COMMAND", async () => {
    const result = await runCli(["nope"], {
      fetchImpl: makeFetch(),
    }) as CliError;
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNKNOWN_COMMAND");
  });
});
