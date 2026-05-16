import { describe, expect, it, vi } from "vitest";
import { runLog } from "./log.js";

describe("runLog", () => {
  it("rejects missing required flags", async () => {
    await expect(runLog({ serverUrl: "https://server.example", token: "" }, { date: "2026-05-07" })).resolves.toEqual({
      ok: false,
      error: { code: "MISSING_ARGUMENT", message: "Missing required arguments: --start, --end, --category" },
    });
  });

  it("rejects invalid time ranges before calling fetch", async () => {
    const fetchImpl = vi.fn();
    await expect(runLog(
      { serverUrl: "https://server.example", token: "" },
      { date: "2026-05-07", start: "16:00", end: "14:00", category: "工作/编程" },
      fetchImpl,
    )).resolves.toEqual({
      ok: false,
      error: { code: "INVALID_TIME_RANGE", message: "End time must be later than start time" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts one structured entry", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, entry: { id: "entry-1" } }), { status: 200 }));

    await expect(runLog(
      { serverUrl: "https://server.example", token: "secret" },
      { date: "2026-05-07", start: "14:00", end: "16:00", category: "工作/编程", note: "重构同步模块" },
      fetchImpl,
    )).resolves.toEqual({ ok: true, entry: { id: "entry-1" } });

    expect(fetchImpl).toHaveBeenCalledWith("https://server.example/api/entries", {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-05-07", start: "14:00", end: "16:00", category: "工作/编程", note: "重构同步模块" }),
    });
  });
});
