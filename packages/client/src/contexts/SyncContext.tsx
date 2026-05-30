import { useLiveQuery } from "dexie-react-hooks";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { db } from "../db/index.ts";
import { useSync } from "../hooks/useSync.ts";
import { getCloudSyncEnabled, setCloudSyncEnabled } from "../lib/cloudSyncSetting.ts";
import { safeGetItem, safeSetItem } from "../lib/safeStorage.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";

export const SYNC_AUTO_THROTTLE_MS = 30_000;

export type SyncStatus = "idle" | "syncing" | "success" | "error" | "disabled" | "pending";

interface DeriveSyncStatusInput {
  cloudSyncEnabled: boolean;
  syncing: boolean;
  error: string | null;
  unsyncedCount: number;
  lastSynced: string | null;
}

interface ShouldRunThrottledSyncInput {
  cloudSyncEnabled: boolean;
  syncing: boolean;
  now: number;
  lastAttemptAt: number | null;
}

export function deriveSyncStatus({
  cloudSyncEnabled,
  syncing,
  error,
  unsyncedCount,
  lastSynced,
}: DeriveSyncStatusInput): SyncStatus {
  if (!cloudSyncEnabled) return "disabled";
  if (syncing) return "syncing";
  if (error) return "error";
  if (unsyncedCount > 0) return "pending";
  if (lastSynced) return "success";
  return "idle";
}

export function shouldRunThrottledSync({
  cloudSyncEnabled,
  syncing,
  now,
  lastAttemptAt,
}: ShouldRunThrottledSyncInput): boolean {
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
  const liveUnsyncedCount = useLiveQuery(() => db.syncLog.where("synced").equals(0).count(), [], 0);
  const lastAutoAttemptAtRef = useRef<number | null>(null);
  const delayedSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingRef = useRef(syncState.syncing);
  const syncRef = useRef(syncState.sync);
  const cloudSyncEnabledRef = useRef(cloudSyncEnabled);

  useEffect(() => {
    syncingRef.current = syncState.syncing;
    syncRef.current = syncState.sync;
    cloudSyncEnabledRef.current = cloudSyncEnabled;
  }, [cloudSyncEnabled, syncState.sync, syncState.syncing]);

  const status = deriveSyncStatus({
    cloudSyncEnabled,
    syncing: syncState.syncing,
    error: syncState.error,
    unsyncedCount: liveUnsyncedCount,
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
    const lastAttemptAt = lastAutoAttemptAtRef.current;
    if (shouldRunThrottledSync({ cloudSyncEnabled, syncing: syncState.syncing, now, lastAttemptAt })) {
      lastAutoAttemptAtRef.current = now;
      await syncState.sync();
      return;
    }

    if (!cloudSyncEnabled || syncState.syncing || lastAttemptAt === null || delayedSyncTimerRef.current) return;

    const delayMs = Math.max(SYNC_AUTO_THROTTLE_MS - (now - lastAttemptAt), 0);
    delayedSyncTimerRef.current = setTimeout(() => {
      delayedSyncTimerRef.current = null;
      void (async () => {
        const count = await db.syncLog.where("synced").equals(0).count();
        if (count === 0 || syncingRef.current || !cloudSyncEnabledRef.current) return;

        lastAutoAttemptAtRef.current = Date.now();
        await syncRef.current();
      })();
    }, delayMs);
  }, [cloudSyncEnabled, syncState.sync, syncState.syncing]);

  useEffect(() => {
    return () => {
      if (delayedSyncTimerRef.current) {
        clearTimeout(delayedSyncTimerRef.current);
      }
    };
  }, []);

  const value = useMemo<SyncContextValue>(
    () => ({
      ...syncState,
      status,
      apiUrl,
      updateApiUrl,
      cloudSyncEnabled,
      setCloudSyncEnabledInContext,
      syncIfStale,
    }),
    [apiUrl, cloudSyncEnabled, setCloudSyncEnabledInContext, status, syncIfStale, syncState, updateApiUrl],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSyncContext(): SyncContextValue {
  const value = useContext(SyncContext);
  if (!value) {
    throw new Error("useSyncContext must be used within SyncProvider");
  }
  return value;
}
