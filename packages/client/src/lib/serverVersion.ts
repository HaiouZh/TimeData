import type { VersionInfo } from "@timedata/shared";
import { ApiError, apiFetch } from "./api.ts";

export interface UpdateStatusInfo {
  updateId: string;
  status: "running" | "succeeded" | "failed" | "unknown";
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  logTail: string;
}

export type ServerVersionResult = { ok: true; version: VersionInfo } | { ok: false; error: string };

export type TriggerUpdateResult =
  | { ok: true; updateId: string }
  | { ok: false; reason: "already-running"; updateId: string | null }
  | { ok: false; reason: "error"; message: string };

export type ServerUpdateOutcome =
  | { kind: "succeeded"; version: string }
  | { kind: "failed"; message: string }
  | { kind: "timeout" };

export interface PollDeps {
  fetchStatus: () => Promise<UpdateStatusInfo | null>;
  fetchVersion: (opts?: { force?: boolean }) => Promise<ServerVersionResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export async function fetchServerVersion(opts?: { force?: boolean }): Promise<ServerVersionResult> {
  try {
    const path = opts?.force ? "/api/version?refresh=1" : "/api/version";
    return { ok: true, version: await apiFetch<VersionInfo>(path) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "获取服务器版本失败" };
  }
}

function extractUpdateId(body: unknown): string | null {
  const id = (body as { error?: { details?: { updateId?: unknown } } })?.error?.details?.updateId;
  return typeof id === "string" ? id : null;
}

export async function triggerServerUpdate(): Promise<TriggerUpdateResult> {
  try {
    const body = await apiFetch<{ updateId: string }>("/api/update", { method: "POST" });
    return { ok: true, updateId: body.updateId };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { ok: false, reason: "already-running", updateId: extractUpdateId(error.body) };
    }
    return { ok: false, reason: "error", message: error instanceof Error ? error.message : "触发更新失败" };
  }
}

export async function fetchUpdateStatus(): Promise<UpdateStatusInfo | null> {
  try {
    return await apiFetch<UpdateStatusInfo>("/api/update/status");
  } catch {
    return null;
  }
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 240_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultPollDeps(): PollDeps {
  return { fetchStatus: fetchUpdateStatus, fetchVersion: fetchServerVersion, sleep: defaultSleep, now: () => Date.now() };
}

/**
 * 发起更新后轮询到终态。自更新会重建容器、杀掉当前进程，所以最可靠的「成功」信号是
 * 重连后运行中的 sha 真的变了（current !== fromSha）；status=failed 用于在容器还没被替换前
 * 捕捉触发失败；都没等到就超时（服务端可能仍在更新）。轮询期间网络错误视作「仍在更新」继续等。
 */
export async function pollServerUpdate(opts: {
  fromSha: string;
  onProgress?: (text: string) => void;
  deps?: PollDeps;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<ServerUpdateOutcome> {
  const deps = opts.deps ?? defaultPollDeps();
  const interval = opts.intervalMs ?? POLL_INTERVAL_MS;
  const timeout = opts.timeoutMs ?? POLL_TIMEOUT_MS;
  const start = deps.now();
  while (deps.now() - start < timeout) {
    opts.onProgress?.("更新中…");
    const status = await deps.fetchStatus().catch(() => null);
    if (status?.status === "failed") {
      const tail = status.logTail?.trim();
      return { kind: "failed", message: tail ? tail.slice(-200) : "服务端报告更新失败" };
    }
    const vr = await deps.fetchVersion({ force: true }).catch((): ServerVersionResult => ({ ok: false, error: "" }));
    if (vr.ok && vr.version.current && vr.version.current !== opts.fromSha) {
      return { kind: "succeeded", version: vr.version.current };
    }
    await deps.sleep(interval);
  }
  return { kind: "timeout" };
}
