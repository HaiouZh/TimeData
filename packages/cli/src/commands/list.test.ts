import { describe, expect, it, vi } from "vitest";
import { runList } from "./list.js";

const config = { serverUrl: "https://server.example", token: "secret" };

describe("runList schema 校验", () => {
  it("响应缺字段时返回 SCHEMA_MISMATCH", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, entries: [{}] }), { status: 200 }));
    const result = await runList(config, { date: "2026-05-19" }, fetchImpl as unknown as typeof fetch) as { ok: false; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("SCHEMA_MISMATCH");
  });

  it("正常响应通过 schema", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      date: "2026-05-19",
      entries: [{
        id: "e1", startTime: "2026-05-19T09:00:00", endTime: "2026-05-19T10:00:00",
        durationMinutes: 60, category: "工作/编程", note: null,
      }],
      summary: { totalMinutes: 60, entryCount: 1 },
    }), { status: 200 }));
    const result = await runList(config, { date: "2026-05-19" }, fetchImpl as unknown as typeof fetch) as { ok: true; entries: Array<{ id: string }> };
    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(1);
  });

  it("rejects ok responses without date, entries, or summary", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await runList(config, { date: "2026-05-19" }, fetchImpl as unknown as typeof fetch) as {
      ok: false;
      error?: { code: string };
    };

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("SCHEMA_MISMATCH");
  });

  it("accepts error responses without success fields", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "VALIDATION_ERROR", message: "Invalid date" } }), {
        status: 400,
      })
    );

    await expect(runList(config, { date: "2026-05-19" }, fetchImpl as unknown as typeof fetch)).resolves.toEqual({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid date" },
    });
  });
});

describe("runList", () => {
  it("requests entries for an explicit date", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true, date: "2026-05-08", entries: [], summary: { totalMinutes: 0, entryCount: 0 },
    }), { status: 200 }));

    await expect(runList(
      { serverUrl: "https://server.example", token: "secret" },
      { date: "2026-05-08" },
      fetchImpl,
    )).resolves.toEqual({
      ok: true, date: "2026-05-08", entries: [], summary: { totalMinutes: 0, entryCount: 0 },
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://server.example/api/entries?date=2026-05-08&format=cli", expect.objectContaining({
      method: "GET",
      headers: { Authorization: "Bearer secret" },
      signal: expect.any(AbortSignal),
    }));
  });

  it("rejects invalid dates before calling fetch", async () => {
    const fetchImpl = vi.fn();

    await expect(runList(
      { serverUrl: "https://server.example", token: "secret" },
      { date: "2026/05/08" },
      fetchImpl,
    )).resolves.toEqual({
      ok: false,
      error: { code: "INVALID_DATE", message: "Invalid date: 2026/05/08" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes API errors through unchanged", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: "AUTH_FAILED", message: "Authentication failed" } }), { status: 401 }));

    await expect(runList(
      { serverUrl: "https://server.example", token: "bad" },
      { date: "2026-05-08" },
      fetchImpl,
    )).resolves.toEqual({
      ok: false,
      error: { code: "AUTH_FAILED", message: "Authentication failed" },
    });
  });
});
