import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useSync } from "../hooks/useSync.ts";
import { getCloudSyncEnabled, setCloudSyncEnabled } from "../lib/cloudSyncSetting.ts";
import { safeGetItem, safeSetItem } from "../lib/safeStorage.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";

export const SYNC_AUTO_THROTTLE_MS = 30_000;

export type SyncStatus = "idle" | "syncing" | "success" | "error" | "disabled";

interface DeriveSyncStatusInput {
  cloudSyncEnabled: boolean;
  syncing: boolean;
  error: string | null;
  lastSynced: string | null;
}

interface ShouldRunThrottledSyncInput {
  cloudSyncEnabled: boolean;
  syncing: boolean;
  now: number;
  lastAttemptAt: number | null;
}

export function deriveSyncStatus({ cloudSyncEnabled, syncing, error, lastSynced }: DeriveSyncStatusInput): SyncStatus {
  if (!cloudSyncEnabled) return "disabled";
  if (syncing) return "syncing";
  if (error) return "error";
  if (lastSynced) return "success";
  return "idle";
}

export function shouldRunThrottledSync({ cloudSyncEnabled, syncing, now, lastAttemptAt }: ShouldRunThrottledSyncInput): boolean {
  if (!cloudSyncEnabled || syncing) return false;
  if (lastAttemptAt === null) return true;
  return now - lastAttemptAt >= SYNC_AUTO_THROTTLE_MS;
}

type SyncActions = ReturnType<typeof useSync>;

export interface SyncContextValue extends SyncActions {
  status: SyncStatus;
  apiUrl: string;
  updateApiUrl: (url: string) => void;
  cloudSyncEnabled: boolean;
  setCloudSyncEnabledInContext: (enabled: boolean) => void;
  syncIfStale: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const syncState = useSync({ autoSyncOnMount: false });
  const [apiUrl, setApiUrl] = useState(() => safeGetItem(STORAGE_KEYS.apiUrl) || "");
  const [cloudSyncEnabled, setCloudSyncEnabledState] = useState(getCloudSyncEnabled);
  const lastAutoAttemptAtRef = useRef<number | null>(null);

  const status = deriveSyncStatus({
    cloudSyncEnabled,
    syncing: syncState.syncing,
    error: syncState.error,
    lastSynced: syncState.lastSynced,
  });

  const updateApiUrl = useCallback((url: string) => {
    safeSetItem(STORAGE_KEYS.apiUrl, url);
    setApiUrl(url);
    setCloudSyncEnabledState(getCloudSyncEnabled());
  }, []);

  const setCloudSyncEnabledInContext = useCallback((enabled: boolean) => {
    setCloudSyncEnabled(enabled);
    setCloudSyncEnabledState(enabled);
  }, []);

  const syncIfStale = useCallback(async () => {
    const now = Date.now();
    if (!shouldRunThrottledSync({ cloudSyncEnabled, syncing: syncState.syncing, now, lastAttemptAt: lastAutoAttemptAtRef.current })) {
      return;
    }

    lastAutoAttemptAtRef.current = now;
    await syncState.sync();
  }, [cloudSyncEnabled, syncState.sync, syncState.syncing]);

  const value = useMemo<SyncContextValue>(() => ({
    ...syncState,
    status,
    apiUrl,
    updateApiUrl,
    cloudSyncEnabled,
    setCloudSyncEnabledInContext,
    syncIfStale,
  }), [
    apiUrl,
    cloudSyncEnabled,
    setCloudSyncEnabledInContext,
    status,
    syncIfStale,
    syncState,
    updateApiUrl,
  ]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSyncContext(): SyncContextValue {
  const value = useContext(SyncContext);
  if (!value) {
    throw new Error("useSyncContext must be used within SyncProvider");
  }
  return value;
}
