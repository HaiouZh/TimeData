import { useState, useCallback, useEffect, useMemo } from "react";
import {
  getConsecutiveSyncFailureCount,
  getSyncHealth,
  prepareForcePush,
  regularSync,
  syncForcePushToServer,
  syncForceReplace,
  type RegularSyncResult,
  type SyncConflict,
} from "../sync/engine.ts";
import { resolveConflicts, type ConflictResolution } from "../sync/conflicts.ts";
import { db } from "../db/index.ts";
import { getCloudSyncEnabled } from "../lib/cloudSyncSetting.ts";
import { safeGetItem, safeSetItem } from "../lib/safeStorage.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";
import type { SyncStreamState } from "../lib/syncStream.js";
import {
  createPhaseRecorder,
  readSyncTransportProtocol,
  recordSyncTiming,
  type SyncTimingOutcome,
} from "../sync/phaseTimings.ts";
import type { SyncExecutorMeta, SyncExecutorOutcome } from "../sync/scheduler.ts";
import type { SyncForcePushPrepareResponse, SyncForcePushResponse, SyncHealthReport } from "@timedata/shared";
import { SYNC_DIAGNOSTIC_FAILURE_THRESHOLD } from "@timedata/shared";

export function shouldAutoSyncOnMount(apiUrl: string | null, cloudSyncEnabled: boolean): boolean {
  return Boolean(apiUrl) && cloudSyncEnabled;
}

export function shouldShowSyncDiagnosticsHint(failureCount: number): boolean {
  return failureCount >= SYNC_DIAGNOSTIC_FAILURE_THRESHOLD;
}

function retryDelayFromSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value * 1_000 : undefined;
}

function retryDelayFromMilliseconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function retryDelayFromHeader(value: unknown, now = Date.now()): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

export function getSyncRetryAfterMs(error: unknown, now = Date.now()): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    retryAfterMs?: unknown;
    retryAfterSec?: unknown;
    body?: unknown;
    headers?: { get?: (name: string) => string | null };
  };
  const body = candidate.body && typeof candidate.body === "object"
    ? candidate.body as { retryAfterMs?: unknown; retryAfterSec?: unknown }
    : null;

  return retryDelayFromMilliseconds(candidate.retryAfterMs)
    ?? retryDelayFromMilliseconds(body?.retryAfterMs)
    ?? retryDelayFromSeconds(candidate.retryAfterSec)
    ?? retryDelayFromSeconds(body?.retryAfterSec)
    ?? retryDelayFromHeader(candidate.headers?.get?.("Retry-After"), now);
}

interface UseSyncOptions {
  autoSyncOnMount?: boolean;
}

export function useSync({ autoSyncOnMount = false }: UseSyncOptions = {}) {
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(
    safeGetItem(STORAGE_KEYS.lastSyncDisplayAt)
  );
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [lastResult, setLastResult] = useState<RegularSyncResult | null>(null);
  const [healthReport, setHealthReport] = useState<SyncHealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [forcePushPreparation, setForcePushPreparation] = useState<SyncForcePushPrepareResponse | null>(null);
  const [syncFailureCount, setSyncFailureCount] = useState(getConsecutiveSyncFailureCount());

  const refreshSyncStatus = useCallback(async () => {
    const count = await db.syncLog.where("synced").equals(0).count();
    setUnsyncedCount(count);
    setLastSynced(safeGetItem(STORAGE_KEYS.lastSyncDisplayAt));
  }, []);

  const sync = useCallback(async (
    meta?: SyncExecutorMeta & { connection?: SyncStreamState },
  ): Promise<SyncExecutorOutcome> => {
    setSyncing(true);
    setError(null);
    setConflicts([]);
    const unsyncedAtStart = await db.syncLog.where("synced").equals(0).count();
    const recorder = createPhaseRecorder();
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    let outcome: SyncTimingOutcome = "error";
    try {
      const result = await regularSync({ phases: recorder });
      setLastResult(result);
      if (result.conflicts.length > 0) {
        setConflicts(result.conflicts);
      }
      outcome = result.identical ? "identical" : result.pushed > 0 ? "pushed" : "pull_only";
      safeSetItem(STORAGE_KEYS.lastSyncDisplayAt, new Date().toISOString());
      await refreshSyncStatus();
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "同步失败");
      const retryAfterMs = getSyncRetryAfterMs(e);
      return retryAfterMs === undefined ? false : { ok: false, retryAfterMs };
    } finally {
      recordSyncTiming({
        at: startedAt,
        outcome,
        totalMs: Math.round(performance.now() - t0),
        phases: recorder.phases,
        visibility: typeof document !== "undefined" ? document.visibilityState : undefined,
        unsyncedAtStart,
        waitMs: meta?.waitMs,
        reason: meta?.reason,
        connection: meta?.connection,
        protocol: readSyncTransportProtocol(),
      });
      setSyncFailureCount(getConsecutiveSyncFailureCount());
      setSyncing(false);
    }
  }, [refreshSyncStatus]);

  const forceReplace = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setConflicts([]);
    try {
      const count = await syncForceReplace();
      await refreshSyncStatus();
      return count;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "强制替换失败");
      return null;
    } finally {
      setSyncing(false);
    }
  }, [refreshSyncStatus]);

  const runDiagnostics = useCallback(async () => {
    setHealthLoading(true);
    setError(null);
    try {
      const report = await getSyncHealth();
      setHealthReport(report);
      return report;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "同步诊断失败");
      return null;
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const prepareForcePushToServer = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const preparation = await prepareForcePush();
      setForcePushPreparation(preparation);
      return preparation;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "全量推送准备失败");
      return null;
    } finally {
      setSyncing(false);
    }
  }, []);

  const forcePushToServer = useCallback(async (confirmToken: string, confirmationPhrase: "OVERWRITE_SERVER") => {
    setSyncing(true);
    setError(null);
    try {
      const result: SyncForcePushResponse = await syncForcePushToServer(confirmToken, confirmationPhrase);
      setForcePushPreparation(null);
      await refreshSyncStatus();
      return result;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "全量推送失败");
      return null;
    } finally {
      setSyncing(false);
    }
  }, [refreshSyncStatus]);

  const handleConflictResolution = useCallback(async (resolution: ConflictResolution) => {
    try {
      await resolveConflicts(conflicts, resolution);
      setConflicts([]);
      await refreshSyncStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "冲突处理失败");
    }
  }, [conflicts, refreshSyncStatus]);

  useEffect(() => {
    refreshSyncStatus();
  }, [refreshSyncStatus]);

  useEffect(() => {
    if (!autoSyncOnMount) return;

    const apiUrl = safeGetItem(STORAGE_KEYS.apiUrl);
    if (shouldAutoSyncOnMount(apiUrl, getCloudSyncEnabled())) {
      sync();
    }
  }, [autoSyncOnMount, sync]);

  const needsSyncDiagnostics = shouldShowSyncDiagnosticsHint(syncFailureCount);

  return useMemo(() => ({
    syncing,
    lastSynced,
    unsyncedCount,
    error,
    conflicts,
    lastResult,
    healthReport,
    healthLoading,
    forcePushPreparation,
    syncFailureCount,
    needsSyncDiagnostics,
    sync,
    forceReplace,
    runDiagnostics,
    prepareForcePushToServer,
    forcePushToServer,
    handleConflictResolution,
    refreshSyncStatus,
  }), [
    conflicts,
    error,
    forcePushPreparation,
    forcePushToServer,
    forceReplace,
    handleConflictResolution,
    healthLoading,
    healthReport,
    lastResult,
    lastSynced,
    needsSyncDiagnostics,
    prepareForcePushToServer,
    refreshSyncStatus,
    runDiagnostics,
    sync,
    syncFailureCount,
    syncing,
    unsyncedCount,
  ]);
}
