import { describe, expect, it, vi } from "vitest";
import { runList } from "./list.js";

describe("runList", () => {
  it("requests entries for an explicit date", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, entries: [] }), { status: 200 }));

    await expect(runList(
      { serverUrl: "https://server.example", token: "secret" },
      { date: "2026-05-08" },
      fetchImpl,
    )).resolves.toEqual({ ok: true, entries: [] });

    expect(fetchImpl).toHaveBeenCalledWith("https://server.example/api/entries?date=2026-05-08&format=cli", {
      method: "GET",
      headers: { Authorization: "Bearer secret" },
    });
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
