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
import { fetchServerHealth } from "../lib/serverHealth.ts";
import { STORAGE_KEYS } from "../lib/storageKeys.js";
import { createPhaseRecorder, recordSyncTiming, type SyncTimingOutcome } from "../sync/phaseTimings.ts";
import type { SyncForcePushPrepareResponse, SyncForcePushResponse, SyncHealthReport } from "@timedata/shared";
import { SYNC_DIAGNOSTIC_FAILURE_THRESHOLD } from "@timedata/shared";

export function shouldAutoSyncOnMount(apiUrl: string | null, cloudSyncEnabled: boolean): boolean {
  return Boolean(apiUrl) && cloudSyncEnabled;
}

export function shouldShowSyncDiagnosticsHint(failureCount: number): boolean {
  return failureCount >= SYNC_DIAGNOSTIC_FAILURE_THRESHOLD;
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

  const sync = useCallback(async (): Promise<boolean> => {
    setSyncing(true);
    setError(null);
    setConflicts([]);
    const recorder = createPhaseRecorder();
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    let outcome: SyncTimingOutcome = "error";
    try {
      const healthy = await recorder.time("health", () => fetchServerHealth());
      if (!healthy) {
        throw new Error("无法连接服务器");
      }
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
      return false;
    } finally {
      recordSyncTiming({
        at: startedAt,
        outcome,
        totalMs: Math.round(performance.now() - t0),
        phases: recorder.phases,
        visibility: typeof document !== "undefined" ? document.visibilityState : undefined,
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
