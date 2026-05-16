import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import updateRoute from "./update.js";

let tempDir: string | null = null;
let originalHostComposeDir: string | undefined;
let app: Hono;

beforeEach(() => {
  originalHostComposeDir = process.env.HOST_COMPOSE_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-update-route-"));
  fs.mkdirSync(path.join(tempDir, "data"), { recursive: true });
  process.env.HOST_COMPOSE_DIR = tempDir;
  app = new Hono().route("/api/update", updateRoute);
});

afterEach(() => {
  if (originalHostComposeDir === undefined) {
    delete process.env.HOST_COMPOSE_DIR;
  } else {
    process.env.HOST_COMPOSE_DIR = originalHostComposeDir;
  }
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("update route", () => {
  it("returns 409 when an update lock already exists", async () => {
    fs.writeFileSync(
      path.join(tempDir!, "data", "update.lock"),
      JSON.stringify({ updateId: "update-1", createdAt: "2026-05-07T12:00:00.000Z" }),
      "utf8",
    );

    const res = await app.request("/api/update", { method: "POST" });
    const body = await res.json() as { error: string; updateId: string | null };

    expect(res.status).toBe(409);
    expect(body).toEqual({ error: "update already running", updateId: "update-1" });
  });
});
