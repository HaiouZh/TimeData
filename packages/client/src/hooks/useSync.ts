import { useState, useCallback, useEffect } from "react";
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
import { createAutoBackup } from "../backup/autoBackup.ts";
import { db } from "../db/index.ts";
import { getCloudSyncEnabled } from "../lib/cloudSyncSetting.ts";
import { safeGetItem } from "../lib/safeStorage.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";
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
    safeGetItem(STORAGE_KEYS.lastSynced)
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
    const count = await db.syncLog.filter((entry) => !entry.synced).count();
    setUnsyncedCount(count);
    setLastSynced(safeGetItem(STORAGE_KEYS.lastSynced));
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setConflicts([]);
    try {
      const result = await regularSync({ beforeMutating: createAutoBackup });
      setLastResult(result);
      if (result.conflicts.length > 0) {
        setConflicts(result.conflicts);
      }
      await refreshSyncStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "同步失败");
    } finally {
      setSyncFailureCount(getConsecutiveSyncFailureCount());
      setSyncing(false);
    }
  }, [refreshSyncStatus]);

  const forceReplace = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setConflicts([]);
    try {
      await createAutoBackup();
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
      await createAutoBackup();
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

  return {
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
    needsSyncDiagnostics: shouldShowSyncDiagnosticsHint(syncFailureCount),
    sync,
    forceReplace,
    runDiagnostics,
    prepareForcePushToServer,
    forcePushToServer,
    handleConflictResolution,
    refreshSyncStatus,
  };
}
