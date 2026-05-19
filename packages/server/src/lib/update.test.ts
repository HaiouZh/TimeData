import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UpdateAlreadyRunningError,
  createUpdateStatus,
  getUpdateStatus,
  triggerUpdate,
  triggerUpdateViaWatchtower,
  updateLockPath,
  updateLogPath,
  updateStatusPath,
} from "./update.js";

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("triggerUpdateViaWatchtower", () => {
  it("posts to the Watchtower update endpoint with bearer token", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

    await triggerUpdateViaWatchtower("http://watchtower:8080", "secret-token", { fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://watchtower:8080/v1/update", {
      method: "POST",
      headers: { Authorization: "Bearer secret-token" },
    });
  });

  it("trims trailing slashes from WATCHTOWER_URL", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

    await triggerUpdateViaWatchtower("http://watchtower:8080///", "secret-token", { fetch: fetchMock });

    expect(fetchMock).toHaveBeenCalledWith("http://watchtower:8080/v1/update", {
      method: "POST",
      headers: { Authorization: "Bearer secret-token" },
    });
  });

  it("throws when Watchtower rejects the update trigger", async () => {
    const fetchMock = vi.fn(async () => new Response("denied", { status: 401 }));

    await expect(
      triggerUpdateViaWatchtower("http://watchtower:8080", "bad-token", { fetch: fetchMock }),
    ).rejects.toThrow(/watchtower update failed: 401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("update status files", () => {
  it("creates and reads running update status", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-update-"));

    const status = createUpdateStatus({
      stateDir: tempDir,
      updateId: "update-1",
      now: () => "2026-05-07T12:00:00.000Z",
    });

    expect(status).toEqual({
      updateId: "update-1",
      status: "running",
      startedAt: "2026-05-07T12:00:00.000Z",
      finishedAt: null,
      exitCode: null,
      logTail: "",
    });
    expect(fs.existsSync(updateStatusPath(tempDir))).toBe(true);
    expect(fs.existsSync(updateLogPath(tempDir))).toBe(true);
    expect(getUpdateStatus(tempDir)).toEqual({
      ...status,
      logTail: "[2026-05-07T12:00:00.000Z] update update-1 started\n",
    });
  });

  it("uses update.lock in the update state directory", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-update-"));

    expect(updateLockPath(tempDir)).toBe(`${tempDir}/update.lock`);
  });
});

describe("triggerUpdate locking", () => {
  it("rejects a second update while update.lock exists", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-update-"));
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(
      updateLockPath(tempDir),
      JSON.stringify({ updateId: "update-1", createdAt: "2026-05-07T12:00:00.000Z" }),
      "utf8",
    );

    expect(() =>
      triggerUpdate({
        stateDir: tempDir!,
        watchtowerUrl: "http://watchtower:8080",
        watchtowerToken: "secret-token",
        fetch: vi.fn() as typeof fetch,
      }),
    ).toThrow(UpdateAlreadyRunningError);
  });

  it("writes succeeded status and releases the lock after Watchtower accepts the update trigger", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-update-"));
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

    triggerUpdate({
      stateDir: tempDir,
      watchtowerUrl: "http://watchtower:8080",
      watchtowerToken: "secret-token",
      fetch: fetchMock,
    });
    await vi.waitFor(() => expect(getUpdateStatus(tempDir).status).toBe("succeeded"));

    expect(fs.existsSync(updateLockPath(tempDir))).toBe(false);
  });

  it("writes failed status and releases the lock when Watchtower rejects the update trigger", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-update-"));
    const fetchMock = vi.fn(async () => new Response("denied", { status: 401 }));

    triggerUpdate({
      stateDir: tempDir,
      watchtowerUrl: "http://watchtower:8080",
      watchtowerToken: "bad-token",
      fetch: fetchMock,
    });
    await vi.waitFor(() => expect(getUpdateStatus(tempDir).status).toBe("failed"));

    expect(getUpdateStatus(tempDir).logTail).toMatch(/watchtower update failed: 401/);
    expect(fs.existsSync(updateLockPath(tempDir))).toBe(false);
  });
});
