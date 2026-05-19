import type { VersionInfo } from "@timedata/shared";
import { apiFetch } from "./api.ts";

export interface UpdateStatusInfo {
  updateId: string;
  status: "running" | "succeeded" | "failed" | "unknown";
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  logTail: string;
}

export async function fetchServerVersion(): Promise<{ ok: true; version: VersionInfo } | { ok: false; error: string }> {
  try {
    return { ok: true, version: await apiFetch<VersionInfo>("/api/version") };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "获取服务器版本失败" };
  }
}

export async function triggerServerUpdate(): Promise<string | null> {
  try {
    const body = await apiFetch<{ updateId: string }>("/api/update", { method: "POST" });
    return body.updateId || null;
  } catch {
    return null;
  }
}

export async function fetchUpdateStatus(): Promise<UpdateStatusInfo | null> {
  try {
    return await apiFetch<UpdateStatusInfo>("/api/update/status");
  } catch {
    return null;
  }
}
