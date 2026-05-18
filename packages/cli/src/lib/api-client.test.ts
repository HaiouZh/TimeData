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

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://server.example/api/entries?format=cli",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer secret" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("maps authentication failures to AUTH_FAILED", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, statusText: "Unauthorized" }),
    );

    const result = await requestJson({ serverUrl: "https://server.example", token: "bad" }, "/api/entries?format=cli", {
      fetchImpl,
    });

    expect(result).toEqual({ ok: false, error: { code: "AUTH_FAILED", message: "Authentication failed" } });
  });

  it("returns TIMEOUT when a request exceeds the default timeout", async () => {
    const fetchImpl = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;

    const result = await requestJson({ serverUrl: "https://example.test", token: "token" }, "/api/test", {
      fetchImpl,
      timeoutMs: 1,
    });

    expect(result).toEqual({ ok: false, error: { code: "TIMEOUT", message: "Request timed out" } });
  });

  it("returns TIMEOUT when fetch rejects with a non-DOM AbortError", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }) as unknown as typeof fetch;

    const result = await requestJson({ serverUrl: "https://example.test", token: "token" }, "/api/test", { fetchImpl });

    expect(result).toEqual({ ok: false, error: { code: "TIMEOUT", message: "Request timed out" } });
  });

  it("returns INVALID_RESPONSE when a successful response is not JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("not-json", { status: 200 })) as unknown as typeof fetch;

    const result = await requestJson({ serverUrl: "https://example.test", token: "token" }, "/api/test", { fetchImpl });

    expect(result).toEqual({ ok: false, error: { code: "INVALID_RESPONSE", message: "Server returned invalid JSON" } });
  });
});
