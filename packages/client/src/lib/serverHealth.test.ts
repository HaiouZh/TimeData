import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchServerHealth } from "./serverHealth.js";

describe("fetchServerHealth", () => {
  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    localStorage.setItem("timedata_api_url", "http://x");
    vi.restoreAllMocks();
  });

  it("200 返回 true", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "ok", db: "ok" })));
    await expect(fetchServerHealth()).resolves.toBe(true);
  });

  it("503 返回 false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", db: "error" }), { status: 503 }),
    );
    await expect(fetchServerHealth()).resolves.toBe(false);
  });

  it("网络失败返回 false", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(fetchServerHealth()).resolves.toBe(false);
  });

  it("打的是 /api/health", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "ok" })));
    await fetchServerHealth();
    expect(spy.mock.calls[0][0]).toBe("http://x/api/health");
  });
});
