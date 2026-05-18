import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let app: Hono;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("UPDATE_REPO", "HaiouZh/TimeData");
  vi.stubEnv("GIT_SHA", "abcdef1234567890");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ workflow_runs: [{ head_sha: "1234567890abcdef" }] }))),
  );
  const { Hono } = await import("hono");
  const { _resetCache } = await import("../lib/version.js");
  _resetCache();
  const versionRoute = (await import("./version.js")).default;
  app = new Hono().route("/api/version", versionRoute);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/version", () => {
  it("returns version info shape", async () => {
    const res = await app.request("/api/version");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      current: "abcdef1",
      latest: "1234567",
      hasUpdate: true,
      checkedAt: expect.any(String),
    });
  });

  it("returns unknown latest when GitHub lookup fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const { _resetCache } = await import("../lib/version.js");
    _resetCache();

    const res = await app.request("/api/version");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      current: "abcdef1",
      latest: "unknown",
      hasUpdate: false,
    });
  });
});
