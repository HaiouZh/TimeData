import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  UpdateAlreadyRunningError,
  buildUpdaterArgs,
  createUpdateStatus,
  getUpdateStatus,
  triggerUpdate,
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

describe("buildUpdaterArgs", () => {
  it("runs compose from the same absolute path used on the host", () => {
    const args = buildUpdaterArgs({ hostComposeDir: "/opt/timedata", image: "docker:24-cli", updateId: "update-1" });
    expect(args).toContain("run");
    expect(args).toContain("--rm");
    expect(args).toContain("-d");
    expect(args).toContain("--name");
    expect(args).toContain("timedata-updater-update-1");
    expect(args).toContain("-v");
    expect(args.join(" ")).toContain("/var/run/docker.sock:/var/run/docker.sock");
    expect(args.join(" ")).toContain("/opt/timedata:/opt/timedata");
    expect(args.join(" ")).toContain("-w /opt/timedata");
    expect(args.join(" ")).not.toContain("/workspace");
    expect(args).toContain("docker:24-cli");
    expect(args.join(" ")).toContain("docker compose pull");
    expect(args.join(" ")).toContain("docker compose up -d --force-recreate");
    expect(args.join(" ")).toContain("/opt/timedata/data/update.log");
    expect(args.join(" ")).toContain("/opt/timedata/data/update-status.json");
  });

  it("passes lock path and writes terminal status from updater script", () => {
    const args = buildUpdaterArgs({
      hostComposeDir: "/opt/timedata",
      image: "docker:24-cli",
      updateId: "update-1",
      startedAt: "2026-05-07T12:00:00.000Z",
    });
    const command = args.join(" ");

    expect(command).toContain("LOCK='/opt/timedata/data/update.lock'");
    expect(command).toContain("trap 'rm -f \"$LOCK\"' EXIT");
    expect(command).toContain("docker compose up -d --force-recreate");
    expect(command).toContain("--network host");
    expect(command).toContain("http://127.0.0.1:3000/api/health");
    expect(command).toContain('docker compose up -d >> "$LOG" 2>&1');
    expect(command).toContain("write_status succeeded 0");
    expect(command).toContain('write_status failed "$code"');
    expect(command).toContain("STARTED_AT='2026-05-07T12:00:00.000Z'");
  });

  it("throws when hostComposeDir is missing", () => {
    expect(() => buildUpdaterArgs({ hostComposeDir: "", image: "docker:24-cli", updateId: "update-1" })).toThrow(
      /HOST_COMPOSE_DIR/,
    );
  });
});

describe("update status files", () => {
  it("creates and reads running update status", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-update-"));

    const status = createUpdateStatus({
      hostComposeDir: tempDir,
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

  it("uses update.lock in the shared data directory", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-update-"));

    expect(updateLockPath(tempDir)).toBe(`${tempDir}/data/update.lock`);
  });
});

describe("triggerUpdate locking", () => {
  it("rejects a second update while update.lock exists", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-update-"));
    fs.mkdirSync(path.join(tempDir, "data"), { recursive: true });
    fs.writeFileSync(
      updateLockPath(tempDir),
      JSON.stringify({ updateId: "update-1", createdAt: "2026-05-07T12:00:00.000Z" }),
      "utf8",
    );

    expect(() => triggerUpdate({ hostComposeDir: tempDir, image: "docker:24-cli", updateId: "update-2" })).toThrow(
      UpdateAlreadyRunningError,
    );
  });
});
