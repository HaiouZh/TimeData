import fs from "node:fs";

export interface UpdaterOpts {
  stateDir: string;
  watchtowerUrl: string;
  watchtowerToken: string;
  updateId?: string;
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

function readLockUpdateId(lockFile: string): string | null {
  try {
    const content = fs.readFileSync(lockFile, "utf8");
    const parsed = JSON.parse(content) as { updateId?: string };
    return parsed.updateId || null;
  } catch {
    return null;
  }
}

function acquireUpdateLock(stateDir: string, updateId: string): void {
  fs.mkdirSync(updateDataDir(stateDir), { recursive: true });
  const lockFile = updateLockPath(stateDir);
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

function releaseUpdateLock(stateDir: string): void {
  fs.rmSync(updateLockPath(stateDir), { force: true });
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
  acquireUpdateLock(opts.stateDir, updateId);
  const status = createUpdateStatus({ stateDir: opts.stateDir, updateId, now: () => startedAt });

  void runUpdate({ ...opts, updateId, startedAt });
  return status;
}
