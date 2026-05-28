import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import updateRoute from "./update.js";

let tempDir: string | null = null;
let originalUpdateStateDir: string | undefined;
let originalWatchtowerUrl: string | undefined;
let originalWatchtowerToken: string | undefined;
let app: Hono;

beforeEach(() => {
  originalUpdateStateDir = process.env.UPDATE_STATE_DIR;
  originalWatchtowerUrl = process.env.WATCHTOWER_URL;
  originalWatchtowerToken = process.env.WATCHTOWER_TOKEN;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-update-route-"));
  fs.mkdirSync(path.join(tempDir, "data"), { recursive: true });
  process.env.UPDATE_STATE_DIR = path.join(tempDir, "data");
  process.env.WATCHTOWER_URL = "http://watchtower:8080";
  process.env.WATCHTOWER_TOKEN = "secret-token";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
  app = new Hono().route("/api/update", updateRoute);
});

afterEach(() => {
  if (originalUpdateStateDir === undefined) {
    delete process.env.UPDATE_STATE_DIR;
  } else {
    process.env.UPDATE_STATE_DIR = originalUpdateStateDir;
  }
  if (originalWatchtowerUrl === undefined) {
    delete process.env.WATCHTOWER_URL;
  } else {
    process.env.WATCHTOWER_URL = originalWatchtowerUrl;
  }
  if (originalWatchtowerToken === undefined) {
    delete process.env.WATCHTOWER_TOKEN;
  } else {
    process.env.WATCHTOWER_TOKEN = originalWatchtowerToken;
  }
  vi.unstubAllGlobals();
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("update route", () => {
  it("returns 202 after triggering Watchtower", async () => {
    const res = await app.request("/api/update", { method: "POST" });
    const body = await res.json() as { ok: boolean; status: string; updateId: string };

    expect(res.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(body.status).toBe("updating");
    expect(body.updateId).toMatch(/^update-/);
    expect(fetch).toHaveBeenCalledWith("http://watchtower:8080/v1/update", {
      method: "POST",
      headers: { Authorization: "Bearer secret-token" },
    });
  });

  it("returns 202 before the Watchtower update request finishes", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    const updateRequest = app.request("/api/update", { method: "POST" });
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 50));

    const res = await Promise.race([updateRequest, timeout]);

    expect(res).not.toBe("timeout");
    expect((res as Response).status).toBe(202);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns SELF_UPDATE_DISABLED when WATCHTOWER_URL is missing", async () => {
    delete process.env.WATCHTOWER_URL;

    const res = await app.request("/api/update", { method: "POST" });
    const body = await res.json() as { ok: boolean; error: { code: string; message: string } };

    expect(res.status).toBe(503);
    expect(body).toEqual({
      ok: false,
      error: {
        code: "SELF_UPDATE_DISABLED",
        message: "Self-update is disabled because WATCHTOWER_URL is not configured",
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns SELF_UPDATE_DISABLED when WATCHTOWER_TOKEN is missing", async () => {
    delete process.env.WATCHTOWER_TOKEN;

    const res = await app.request("/api/update", { method: "POST" });
    const body = await res.json() as { ok: boolean; error: { code: string; message: string } };

    expect(res.status).toBe(503);
    expect(body).toEqual({
      ok: false,
      error: {
        code: "SELF_UPDATE_DISABLED",
        message: "Self-update is disabled because WATCHTOWER_TOKEN is not configured",
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses UPDATE_STATE_DIR for update state files", async () => {
    const res = await app.request("/api/update", { method: "POST" });

    expect(res.status).toBe(202);
    expect(fs.existsSync(path.join(tempDir!, "data", "update-status.json"))).toBe(true);
  });

  it("returns 409 when a fresh update lock already exists", async () => {
    fs.writeFileSync(
      path.join(tempDir!, "data", "update.lock"),
      JSON.stringify({ updateId: "update-1", createdAt: new Date().toISOString() }),
      "utf8",
    );

    const res = await app.request("/api/update", { method: "POST" });
    const body = await res.json() as { ok: boolean; error: { code: string; message: string; details?: { updateId: string | null } } };

    expect(res.status).toBe(409);
    expect(body).toEqual({ ok: false, error: { code: "CONFLICT", message: "update already running", details: { updateId: "update-1" } } });
  });
});
