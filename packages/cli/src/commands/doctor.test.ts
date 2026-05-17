import { describe, expect, it, vi } from "vitest";
import { runDoctor } from "./doctor.js";

describe("runDoctor", () => {
  it("reports missing configuration without calling fetch", async () => {
    const fetchImpl = vi.fn();

    await expect(runDoctor({}, {}, null, fetchImpl)).resolves.toEqual({
      ok: false,
      checks: [
        { name: "config", ok: false, code: "CONFIG_MISSING", message: "Missing TimeData server URL" },
      ],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports invalid config files without calling fetch", async () => {
    const fetchImpl = vi.fn();

    await expect(runDoctor({}, {}, { ok: false, error: { code: "CONFIG_INVALID", message: "Invalid config file: config.json" } }, fetchImpl)).resolves.toEqual({
      ok: false,
      checks: [
        { name: "config", ok: false, code: "CONFIG_INVALID", message: "Invalid config file: config.json" },
      ],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports invalid server URLs without calling fetch", async () => {
    const fetchImpl = vi.fn();

    await expect(runDoctor({ server: "not-a-url" }, {}, null, fetchImpl)).resolves.toEqual({
      ok: false,
      checks: [
        { name: "config", ok: true, message: "Configuration resolved" },
        { name: "serverUrl", ok: false, code: "CONFIG_INVALID", message: "Server URL must be http or https" },
      ],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports network failures from the health check", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connection refused");
    });

    await expect(runDoctor({ server: "https://server.example", token: "secret" }, {}, null, fetchImpl)).resolves.toEqual({
      ok: false,
      checks: [
        { name: "config", ok: true, message: "Configuration resolved" },
        { name: "serverUrl", ok: true, message: "Server URL is valid" },
        { name: "server", ok: false, code: "NETWORK_ERROR", message: "connection refused" },
      ],
    });
  });

  it("reports authentication failures from the read-only categories check", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, statusText: "Unauthorized" }));

    await expect(runDoctor({ server: "https://server.example", token: "bad" }, {}, null, fetchImpl)).resolves.toEqual({
      ok: false,
      checks: [
        { name: "config", ok: true, message: "Configuration resolved" },
        { name: "serverUrl", ok: true, message: "Server URL is valid" },
        { name: "server", ok: true, message: "Server health check passed" },
        { name: "auth", ok: false, code: "AUTH_FAILED", message: "Authentication failed" },
      ],
    });
  });

  it("passes when health and read-only authentication work", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    await expect(runDoctor({ server: "https://server.example", token: "secret" }, {}, null, fetchImpl)).resolves.toEqual({
      ok: true,
      checks: [
        { name: "config", ok: true, message: "Configuration resolved" },
        { name: "serverUrl", ok: true, message: "Server URL is valid" },
        { name: "server", ok: true, message: "Server health check passed" },
        { name: "auth", ok: true, message: "Read-only API check passed" },
      ],
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://server.example/api/health", expect.objectContaining({
      method: "GET",
      headers: { Authorization: "Bearer secret" },
      signal: expect.any(AbortSignal),
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "https://server.example/api/categories", expect.objectContaining({
      method: "GET",
      headers: { Authorization: "Bearer secret" },
      signal: expect.any(AbortSignal),
    }));
  });
});
