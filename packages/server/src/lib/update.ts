import fs from "node:fs";

// A self-update replaces this very container, so the process that holds the
// lock is killed by Watchtower before it can release it. Any lock older than
// this is treated as a leftover from such an interrupted update, not a live one.
const STALE_LOCK_TTL_MS = 15 * 60 * 1000;

export interface UpdaterOpts {
  stateDir: string;
  watchtowerUrl: string;
  watchtowerToken: string;
  updateId?: string;
  /** Image sha this process is running when the update is triggered, recorded
   * so a restarted process can tell whether the new image actually landed. */
  currentSha?: string;
  fetch?: typeof fetch;
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

function updatePath(stateDir: string, fileName: string): string {
  return `${stateDir.replace(/\/+$/, "")}/${fileName}`;
}

export function updateLogPath(stateDir: string): string {
  return updatePath(stateDir, "update.log");
}

export function updateStatusPath(stateDir: string): string {
  return updatePath(stateDir, "update-status.json");
}

export function updateLockPath(stateDir: string): string {
  return updatePath(stateDir, "update.lock");
}

function updateDataDir(stateDir: string): string {
  return stateDir.replace(/\/+$/, "");
}

function logTail(filePath: string, maxChars = 4000): string {
  if (!fs.existsSync(filePath)) return "";
  const content = fs.readFileSync(filePath, "utf8");
  return content.slice(-maxChars);
}

function appendUpdateLog(stateDir: string, message: string): void {
  fs.appendFileSync(updateLogPath(stateDir), `[${new Date().toISOString()}] ${message}\n`, "utf8");
}

function writeTerminalStatus(opts: {
  stateDir: string;
  updateId: string;
  startedAt: string;
  status: "succeeded" | "failed";
  exitCode: number;
}): void {
  const finishedAt = new Date().toISOString();
  const status: Omit<UpdateStatus, "logTail"> = {
    updateId: opts.updateId,
    status: opts.status,
    startedAt: opts.startedAt,
    finishedAt,
    exitCode: opts.exitCode,
  };
  fs.writeFileSync(updateStatusPath(opts.stateDir), JSON.stringify(status, null, 2), "utf8");
}

export function createUpdateStatus(opts: {
  stateDir: string;
  updateId: string;
  now?: () => string;
}): UpdateStatus {
  const now = opts.now ? opts.now() : new Date().toISOString();
  fs.mkdirSync(updateDataDir(opts.stateDir), { recursive: true });
  fs.writeFileSync(updateLogPath(opts.stateDir), `[${now}] update ${opts.updateId} started\n`, "utf8");
  const status: UpdateStatus = {
    updateId: opts.updateId,
    status: "running",
    startedAt: now,
    finishedAt: null,
    exitCode: null,
    logTail: "",
  };
  fs.writeFileSync(updateStatusPath(opts.stateDir), JSON.stringify(status, null, 2), "utf8");
  return status;
}

export function getUpdateStatus(stateDir: string): UpdateStatus {
  const statusFile = updateStatusPath(stateDir);
  if (!fs.existsSync(statusFile)) {
    return { updateId: "", status: "unknown", startedAt: null, finishedAt: null, exitCode: null, logTail: "" };
  }
  const status = JSON.parse(fs.readFileSync(statusFile, "utf8")) as Omit<UpdateStatus, "logTail">;
  return { ...status, logTail: logTail(updateLogPath(stateDir)) };
}

async function fetchOrThrow(response: Response, context: string): Promise<void> {
  if (response.ok) return;
  throw new Error(`${context}: ${response.status}`);
}

export async function triggerUpdateViaWatchtower(
  watchtowerUrl: string,
  watchtowerToken: string,
  opts?: { fetch?: typeof fetch },
): Promise<void> {
  const fetchImpl = opts?.fetch ?? globalThis.fetch;
  const baseUrl = watchtowerUrl.replace(/\/+$/, "");
  const response = await fetchImpl(`${baseUrl}/v1/update`, {
    method: "POST",
    headers: { Authorization: `Bearer ${watchtowerToken}` },
  });
  await fetchOrThrow(response, "watchtower update failed");
}

function readLock(lockFile: string): { updateId: string | null; createdAt: string | null; fromSha: string | null } {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockFile, "utf8")) as {
      updateId?: string;
      createdAt?: string;
      fromSha?: string;
    };
    return {
      updateId: parsed.updateId || null,
      createdAt: parsed.createdAt || null,
      fromSha: parsed.fromSha || null,
    };
  } catch {
    return { updateId: null, createdAt: null, fromSha: null };
  }
}

function isStaleLock(lockFile: string): boolean {
  const { createdAt } = readLock(lockFile);
  if (!createdAt) return true;
  const age = Date.now() - Date.parse(createdAt);
  return Number.isNaN(age) || age > STALE_LOCK_TTL_MS;
}

function writeLock(stateDir: string, updateId: string, fromSha: string | null): void {
  const fd = fs.openSync(updateLockPath(stateDir), "wx");
  try {
    fs.writeFileSync(
      fd,
      JSON.stringify({ updateId, createdAt: new Date().toISOString(), fromSha }, null, 2),
      "utf8",
    );
  } finally {
    fs.closeSync(fd);
  }
}

function acquireUpdateLock(stateDir: string, updateId: string, fromSha: string | null): void {
  fs.mkdirSync(updateDataDir(stateDir), { recursive: true });
  const lockFile = updateLockPath(stateDir);
  try {
    writeLock(stateDir, updateId, fromSha);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    if (!isStaleLock(lockFile)) {
      throw new UpdateAlreadyRunningError(readLock(lockFile).updateId);
    }
    releaseUpdateLock(stateDir);
    writeLock(stateDir, updateId, fromSha);
  }
}

function releaseUpdateLock(stateDir: string): void {
  fs.rmSync(updateLockPath(stateDir), { force: true });
}

// Decide how an interrupted update turned out by comparing the image sha that
// was recorded when the update was triggered against the sha this (restarted)
// process is now running. A changed sha means Watchtower really replaced the
// container with a new image -> the update succeeded. An unchanged sha means
// the restart did not pick up a new image -> it failed. Without a recorded sha
// (lock written by an older build) or a known current sha (dev/local), we
// cannot tell, so we stay with "unknown".
function resolveInterruptedStatus(
  fromSha: string | null,
  currentSha: string | undefined,
): "succeeded" | "failed" | "unknown" {
  if (!fromSha || !currentSha || currentSha === "dev") return "unknown";
  return currentSha !== fromSha ? "succeeded" : "failed";
}

// Called at server startup. A lock present here means the previous update
// process was killed (by the container restart that the update itself caused)
// before it could release the lock and write its terminal status. Without this,
// the stale lock would block every future update with a 409 forever, and the
// success the killed process never got to record would be lost. We infer the
// outcome from whether the running image sha changed (see resolveInterruptedStatus).
export function reconcileInterruptedUpdate(stateDir: string, currentSha?: string): void {
  const lockFile = updateLockPath(stateDir);
  if (!fs.existsSync(lockFile)) return;
  const { updateId, fromSha } = readLock(lockFile);
  appendUpdateLog(stateDir, "previous update was interrupted by a container restart; recovering");
  const prior = getUpdateStatus(stateDir);
  const status = resolveInterruptedStatus(fromSha, currentSha);
  appendUpdateLog(stateDir, `recovery verdict: ${status} (sha ${fromSha ?? "?"} -> ${currentSha ?? "?"})`);
  fs.writeFileSync(
    updateStatusPath(stateDir),
    JSON.stringify(
      {
        updateId: updateId ?? prior.updateId,
        status,
        startedAt: prior.startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: status === "succeeded" ? 0 : null,
      },
      null,
      2,
    ),
    "utf8",
  );
  releaseUpdateLock(stateDir);
}

async function runUpdate(opts: UpdaterOpts & { updateId: string; startedAt: string }): Promise<void> {
  try {
    appendUpdateLog(opts.stateDir, "watchtower update requested");
    await triggerUpdateViaWatchtower(opts.watchtowerUrl, opts.watchtowerToken, { fetch: opts.fetch });
    appendUpdateLog(opts.stateDir, "watchtower update accepted");
    writeTerminalStatus({
      stateDir: opts.stateDir,
      updateId: opts.updateId,
      startedAt: opts.startedAt,
      status: "succeeded",
      exitCode: 0,
    });
  } catch (error) {
    appendUpdateLog(opts.stateDir, `update failed: ${(error as Error).message}`);
    writeTerminalStatus({
      stateDir: opts.stateDir,
      updateId: opts.updateId,
      startedAt: opts.startedAt,
      status: "failed",
      exitCode: 1,
    });
  } finally {
    releaseUpdateLock(opts.stateDir);
  }
}

export function triggerUpdate(opts: UpdaterOpts): UpdateStatus {
  if (!opts.stateDir) {
    throw new Error("UPDATE_STATE_DIR env var is required to trigger update");
  }
  const updateId = opts.updateId || `update-${Date.now()}`;
  const startedAt = new Date().toISOString();
  acquireUpdateLock(opts.stateDir, updateId, opts.currentSha ?? null);
  try {
    const status = createUpdateStatus({ stateDir: opts.stateDir, updateId, now: () => startedAt });

    void runUpdate({ ...opts, updateId, startedAt });
    return status;
  } catch (error) {
    releaseUpdateLock(opts.stateDir);
    throw error;
  }
}
