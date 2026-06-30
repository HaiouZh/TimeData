import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetCache, fetchLatestSha, getVersionInfo } from "./version.js";

const originalFetch = global.fetch;

beforeEach(() => {
  _resetCache();
  global.fetch = originalFetch;
  delete process.env.GITHUB_TOKEN;
});

describe("fetchLatestSha", () => {
  it("returns the head_sha (first 7 chars) of the latest successful run", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workflow_runs: [{ head_sha: "abcdef1234567890", status: "completed", conclusion: "success" }],
      }),
    }) as unknown as typeof fetch;

    const sha = await fetchLatestSha("HaiouZh", "TimeData");
    expect(sha).toBe("abcdef1");
  });

  it("returns 'unknown' when no runs", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflow_runs: [] }),
    }) as unknown as typeof fetch;
    const sha = await fetchLatestSha("HaiouZh", "TimeData");
    expect(sha).toBe("unknown");
  });

  it("returns 'unknown' on network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const sha = await fetchLatestSha("HaiouZh", "TimeData");
    expect(sha).toBe("unknown");
  });
});

describe("getVersionInfo", () => {
  it("hasUpdate=true when current and latest differ", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflow_runs: [{ head_sha: "deadbeef00000000" }] }),
    }) as unknown as typeof fetch;

    const info = await getVersionInfo({ currentSha: "abc1234", repo: "HaiouZh/TimeData" });
    expect(info.current).toBe("abc1234");
    expect(info.latest).toBe("deadbee");
    expect(info.hasUpdate).toBe(true);
  });

  it("hasUpdate=false when same", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflow_runs: [{ head_sha: "abc12340000" }] }),
    }) as unknown as typeof fetch;
    const info = await getVersionInfo({ currentSha: "abc1234", repo: "HaiouZh/TimeData" });
    expect(info.hasUpdate).toBe(false);
  });

  it("hasUpdate=false when current is 'dev'", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflow_runs: [{ head_sha: "deadbeef" }] }),
    }) as unknown as typeof fetch;
    const info = await getVersionInfo({ currentSha: "dev", repo: "HaiouZh/TimeData" });
    expect(info.hasUpdate).toBe(false);
  });

  it("checkOk=false when latest unknown, and does not claim up-to-date", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    const info = await getVersionInfo({ currentSha: "abc1234", repo: "HaiouZh/TimeData" });
    expect(info.latest).toBe("unknown");
    expect(info.checkOk).toBe(false);
    expect(info.hasUpdate).toBe(false);
  });

  it("checkOk=true when latest resolved", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflow_runs: [{ head_sha: "deadbeef00000000" }] }),
    }) as unknown as typeof fetch;
    const info = await getVersionInfo({ currentSha: "abc1234", repo: "HaiouZh/TimeData" });
    expect(info.checkOk).toBe(true);
  });

  it("force=true bypasses the cache", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflow_runs: [{ head_sha: "1111111aaaa" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflow_runs: [{ head_sha: "2222222bbbb" }] }) });
    global.fetch = mockFetch as unknown as typeof fetch;

    const first = await getVersionInfo({ currentSha: "x", repo: "a/b" });
    const second = await getVersionInfo({ currentSha: "x", repo: "a/b", force: true });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(first.latest).toBe("1111111");
    expect(second.latest).toBe("2222222");
  });

  it("caches result for 5 minutes", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflow_runs: [{ head_sha: "aaaaaaa1111" }] }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    await getVersionInfo({ currentSha: "x", repo: "a/b" });
    await getVersionInfo({ currentSha: "x", repo: "a/b" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("uses GITHUB_TOKEN when available", async () => {
    process.env.GITHUB_TOKEN = "github-token";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflow_runs: [{ head_sha: "abcdef1234567890" }] }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    await fetchLatestSha("HaiouZh", "TimeData");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer github-token" }),
      }),
    );
    delete process.env.GITHUB_TOKEN;
  });
});
