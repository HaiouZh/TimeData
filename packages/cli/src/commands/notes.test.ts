import { describe, expect, it, vi } from "vitest";
import { runNotes } from "./notes.js";

const config = { serverUrl: "https://server.example", token: "secret" };

describe("runNotes", () => {
  it("requests notes for an explicit date", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          mode: "date",
          date: "2026-06-02",
          quickNotes: [],
          summary: { count: 0 },
          serverTime: "2026-06-02T08:00:00.000Z",
        }),
        { status: 200 },
      ),
    );

    await expect(runNotes(config, { date: "2026-06-02" }, fetchImpl)).resolves.toMatchObject({
      ok: true,
      mode: "date",
      date: "2026-06-02",
      quickNotes: [],
      summary: { count: 0 },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://server.example/api/quick-notes?date=2026-06-02&format=cli",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer secret" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("requests notes for an inclusive date range", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          mode: "range",
          from: "2026-06-01",
          to: "2026-06-02",
          quickNotes: [
            {
              id: "note-1",
              occurredAt: "2026-06-01T16:00:00.000Z",
              occurredLocal: "2026-06-02T00:00:00",
              text: "hello",
            },
          ],
          summary: { count: 1 },
          serverTime: "2026-06-02T08:00:00.000Z",
        }),
        { status: 200 },
      ),
    );

    const result = await runNotes(config, { from: "2026-06-01", to: "2026-06-02" }, fetchImpl) as {
      ok: true;
      quickNotes: Array<{ id: string }>;
    };

    expect(result.ok).toBe(true);
    expect(result.quickNotes).toEqual([expect.objectContaining({ id: "note-1" })]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://server.example/api/quick-notes?from=2026-06-01&to=2026-06-02&format=cli",
      expect.any(Object),
    );
  });

  it("requests recent notes with a limit", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          mode: "recent",
          quickNotes: [],
          summary: { count: 0 },
          serverTime: "2026-06-02T08:00:00.000Z",
        }),
        { status: 200 },
      ),
    );

    await expect(runNotes(config, { recent: "true", limit: "20" }, fetchImpl)).resolves.toMatchObject({
      ok: true,
      mode: "recent",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://server.example/api/quick-notes?recent=1&limit=20&format=cli",
      expect.any(Object),
    );
  });

  it("rejects invalid dates before calling fetch", async () => {
    const fetchImpl = vi.fn();

    await expect(runNotes(config, { date: "2026/06/02" }, fetchImpl)).resolves.toEqual({
      ok: false,
      error: { code: "INVALID_DATE", message: "Invalid date: 2026/06/02" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects partial ranges before calling fetch", async () => {
    const fetchImpl = vi.fn();

    await expect(runNotes(config, { from: "2026-06-01" }, fetchImpl)).resolves.toEqual({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "--from and --to must be provided together" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects invalid limits before calling fetch", async () => {
    const fetchImpl = vi.fn();

    await expect(runNotes(config, { recent: "true", limit: "0" }, fetchImpl)).resolves.toEqual({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "--limit must be an integer between 1 and 200" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes API errors through unchanged", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "AUTH_FAILED", message: "Authentication failed" } }), {
        status: 401,
      }),
    );

    await expect(runNotes(config, { date: "2026-06-02" }, fetchImpl)).resolves.toEqual({
      ok: false,
      error: { code: "AUTH_FAILED", message: "Authentication failed" },
    });
  });

  it("returns SCHEMA_MISMATCH for unexpected success responses", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, quickNotes: [{}] }), { status: 200 }));

    const result = await runNotes(config, { date: "2026-06-02" }, fetchImpl) as {
      ok: false;
      error?: { code: string };
    };

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("SCHEMA_MISMATCH");
  });
});
