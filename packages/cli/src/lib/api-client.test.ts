import { describe, expect, it, vi } from "vitest";
import { requestJson } from "./api-client.js";

describe("requestJson", () => {
  it("sends bearer token and parses JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await requestJson(
      { serverUrl: "https://server.example/", token: "secret" },
      "/api/entries?format=cli",
      { fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledWith("https://server.example/api/entries?format=cli", {
      method: "GET",
      headers: { Authorization: "Bearer secret" },
    });
    expect(result).toEqual({ ok: true });
  });

  it("maps authentication failures to AUTH_FAILED", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, statusText: "Unauthorized" }));

    const result = await requestJson(
      { serverUrl: "https://server.example", token: "bad" },
      "/api/entries?format=cli",
      { fetchImpl },
    );

    expect(result).toEqual({ ok: false, error: { code: "AUTH_FAILED", message: "Authentication failed" } });
  });
});
