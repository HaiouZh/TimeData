import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface UpdaterOpts {
  hostComposeDir: string;
  image: string;
  updateId?: string;
}

export interface UpdateStatus {
  updateId: string;
  status: "running" | "succeeded" | "failed" | "unknown";
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  logTail: string;
}

export class UpdateAlreadyRunningError extends Error {
  constructor(public readonly updateId: string | null) {
    super("update already running");
    this.name = "UpdateAlreadyRunningError";
  }
}

function updatePath(hostComposeDir: string, fileName: string): string {
  return `${hostComposeDir.replace(/\/+$/, "")}/data/${fileName}`;
}

export function updateLogPath(hostComposeDir: string): string {
  return updatePath(hostComposeDir, "update.log");
}

export function updateStatusPath(hostComposeDir: string): string {
  return updatePath(hostComposeDir, "update-status.json");
}

export function updateLockPath(hostComposeDir: string): string {
  return updatePath(hostComposeDir, "update.lock");
}

function updateDataDir(hostComposeDir: string): string {
  return updatePath(hostComposeDir, "").replace(/\/+$/, "");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function logTail(filePath: string, maxChars = 4000): string {
  if (!fs.existsSync(filePath)) return "";
  const content = fs.readFileSync(filePath, "utf8");
  return content.slice(-maxChars);
}

export function createUpdateStatus(opts: { hostComposeDir: string; updateId: string; now?: () => string }): UpdateStatus {
  const now = opts.now ? opts.now() : new Date().toISOString();
  fs.mkdirSync(updateDataDir(opts.hostComposeDir), { recursive: true });
  fs.writeFileSync(updateLogPath(opts.hostComposeDir), `[${now}] update ${opts.updateId} started\n`, "utf8");
  const status: UpdateStatus = {
    updateId: opts.updateId,
    status: "running",
    startedAt: now,
    finishedAt: null,
    exitCode: null,
    logTail: "",
  };
  fs.writeFileSync(updateStatusPath(opts.hostComposeDir), JSON.stringify(status, null, 2), "utf8");
  return status;
}

export function getUpdateStatus(hostComposeDir: string): UpdateStatus {
  const statusFile = updateStatusPath(hostComposeDir);
  if (!fs.existsSync(statusFile)) {
    return { updateId: "", status: "unknown", startedAt: null, finishedAt: null, exitCode: null, logTail: "" };
  }
  const status = JSON.parse(fs.readFileSync(statusFile, "utf8")) as Omit<UpdateStatus, "logTail">;
  return { ...status, logTail: logTail(updateLogPath(hostComposeDir)) };
}

export function buildUpdaterArgs(opts: UpdaterOpts & { startedAt?: string }): string[] {
  if (!opts.hostComposeDir) {
    throw new Error("HOST_COMPOSE_DIR env var is required to trigger update");
  }
  const updateId = opts.updateId || `update-${Date.now()}`;
  const startedAt = opts.startedAt || new Date().toISOString();
  const logFile = updateLogPath(opts.hostComposeDir);
  const statusFile = updateStatusPath(opts.hostComposeDir);
  const lockFile = updateLockPath(opts.hostComposeDir);
  const command = [
    `set +e`,
    `LOG=${shellQuote(logFile)}`,
    `STATUS=${shellQuote(statusFile)}`,
    `LOCK=${shellQuote(lockFile)}`,
    `UPDATE_ID=${shellQuote(updateId)}`,
    `STARTED_AT=${shellQuote(startedAt)}`,
    `trap 'rm -f "$LOCK"' EXIT`,
    `write_status() { printf '{"updateId":"%s","status":"%s","startedAt":"%s","finishedAt":"%s","exitCode":%s}\n' "$UPDATE_ID" "$1" "$STARTED_AT" "$(date -Iseconds)" "$2" > "$STATUS"; }`,
    `health_check() { i=0; while [ "$i" -lt 30 ]; do wget -q -O - http://127.0.0.1:3000/api/health >/dev/null 2>&1 && return 0; i=$((i + 1)); sleep 2; done; return 1; }`,
    `echo "[$(date -Iseconds)] docker compose pull" >> "$LOG"`,
    `docker compose pull >> "$LOG" 2>&1`,
    `pull_code=$?`,
    `echo "[$(date -Iseconds)] docker compose up -d --force-recreate" >> "$LOG"`,
    `docker compose up -d --force-recreate >> "$LOG" 2>&1`,
    `up_code=$?`,
    `if [ "$pull_code" -eq 0 ] && [ "$up_code" -eq 0 ] && health_check; then write_status succeeded 0; exit 0; fi`,
    `code=$up_code`,
    `if [ "$pull_code" -ne 0 ]; then code=$pull_code; fi`,
    `echo "[$(date -Iseconds)] update failed or health check failed; attempting docker compose up -d recovery" >> "$LOG"`,
    `docker compose up -d >> "$LOG" 2>&1`,
    `recover_code=$?`,
    `if [ "$recover_code" -eq 0 ] && health_check; then write_status succeeded 0; exit 0; fi`,
    `if [ "$recover_code" -ne 0 ]; then code=$recover_code; fi`,
    `write_status failed "$code"`,
    `exit "$code"`,
  ].join("; ");

  return [
    "run", "--rm", "-d",
    "--network", "host",
    "--name", `timedata-updater-${updateId}`,
    "-v", "/var/run/docker.sock:/var/run/docker.sock",
    "-v", `${opts.hostComposeDir}:${opts.hostComposeDir}`,
    "-w", opts.hostComposeDir,
    opts.image,
    "sh", "-c", command,
  ];
}

function readLockUpdateId(lockFile: string): string | null {
  try {
    const content = fs.readFileSync(lockFile, "utf8");
    const parsed = JSON.parse(content) as { updateId?: string };
    return parsed.updateId || null;
  } catch {
    return null;
  }
}

function acquireUpdateLock(hostComposeDir: string, updateId: string): void {
  fs.mkdirSync(updateDataDir(hostComposeDir), { recursive: true });
  const lockFile = updateLockPath(hostComposeDir);
  let fd: number | null = null;
  try {
    fd = fs.openSync(lockFile, "wx");
    fs.writeFileSync(fd, JSON.stringify({ updateId, createdAt: new Date().toISOString() }, null, 2), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new UpdateAlreadyRunningError(readLockUpdateId(lockFile));
    }
    throw err;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

export function triggerUpdate(opts: UpdaterOpts): UpdateStatus {
  const updateId = opts.updateId || `update-${Date.now()}`;
  const startedAt = new Date().toISOString();
  acquireUpdateLock(opts.hostComposeDir, updateId);
  const status = createUpdateStatus({ hostComposeDir: opts.hostComposeDir, updateId, now: () => startedAt });
  const args = buildUpdaterArgs({ ...opts, updateId, startedAt: status.startedAt || undefined });
  const child = spawn("docker", args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return status;
}
