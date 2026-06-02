import { useLiveQuery } from "dexie-react-hooks";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { db } from "../db/index.ts";
import { useSync } from "../hooks/useSync.ts";
import { getCloudSyncEnabled, setCloudSyncEnabled } from "../lib/cloudSyncSetting.ts";
import { safeGetItem, safeSetItem } from "../lib/safeStorage.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";
import { createSyncStream, type SyncStreamMessage, type SyncStreamState } from "../lib/syncStream.js";
import { getLastSyncedSeq } from "../sync/engine.ts";

export const SYNC_STALE_THROTTLE_MS = 30_000;
export const SYNC_WRITE_DEBOUNCE_MS = 1500;
export const SYNC_BUMP_DEBOUNCE_MS = 200;

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
  return now - lastAttemptAt >= SYNC_STALE_THROTTLE_MS;
}

export function shouldPullForBump(remoteSeq: number | null, localSeq: number | null): boolean {
  if (remoteSeq == null) return false;
  if (localSeq == null) return true;
  return remoteSeq > localSeq;
}

type SyncActions = ReturnType<typeof useSync>;

export interface SyncContextValue extends SyncActions {
  status: SyncStatus;
  apiUrl: string;
  updateApiUrl: (url: string) => void;
  cloudSyncEnabled: boolean;
  setCloudSyncEnabledInContext: (enabled: boolean) => void;
  syncIfStale: () => Promise<void>;
  syncAfterWrite: () => void;
  connection: SyncStreamState;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const syncState = useSync({ autoSyncOnMount: false });
  const [apiUrl, setApiUrl] = useState(() => safeGetItem(STORAGE_KEYS.apiUrl) || "");
  const [cloudSyncEnabled, setCloudSyncEnabledState] = useState(getCloudSyncEnabled);
  const [connection, setConnection] = useState<SyncStreamState>("disconnected");
  const liveUnsyncedCount = useLiveQuery(() => db.syncLog.where("synced").equals(0).count(), [], 0);
  const lastAutoAttemptAtRef = useRef<number | null>(null);
  const delayedSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const runSyncIfUnsynced = useCallback(async () => {
    const count = await db.syncLog.where("synced").equals(0).count();
    if (count === 0 || syncingRef.current || !cloudSyncEnabledRef.current) return;

    lastAutoAttemptAtRef.current = Date.now();
    await syncRef.current();
  }, []);

  const syncIfStale = useCallback(async (now = Date.now()) => {
    const lastAttemptAt = lastAutoAttemptAtRef.current;
    if (shouldRunThrottledSync({ cloudSyncEnabled, syncing: syncState.syncing, now, lastAttemptAt })) {
      lastAutoAttemptAtRef.current = now;
      await syncState.sync();
      return;
    }

    if (!cloudSyncEnabled || syncState.syncing || lastAttemptAt === null || delayedSyncTimerRef.current) return;

    const delayMs = Math.max(SYNC_STALE_THROTTLE_MS - (now - lastAttemptAt), 0);
    delayedSyncTimerRef.current = setTimeout(() => {
      delayedSyncTimerRef.current = null;
      void runSyncIfUnsynced();
    }, delayMs);
  }, [cloudSyncEnabled, runSyncIfUnsynced, syncState.sync, syncState.syncing]);

  const syncAfterWrite = useCallback(() => {
    if (!cloudSyncEnabled || syncState.syncing) return;
    if (writeSyncTimerRef.current) {
      clearTimeout(writeSyncTimerRef.current);
    }
    writeSyncTimerRef.current = setTimeout(() => {
      writeSyncTimerRef.current = null;
      void runSyncIfUnsynced();
    }, SYNC_WRITE_DEBOUNCE_MS);
  }, [cloudSyncEnabled, runSyncIfUnsynced, syncState.syncing]);

  const handleSyncStreamMessage = useCallback((message: SyncStreamMessage) => {
    if (message.event !== "hello" && message.event !== "bump") return;

    let latestSeq: number | null = null;
    try {
      const parsed = JSON.parse(message.data) as { latestSeq?: unknown };
      latestSeq = typeof parsed.latestSeq === "number" ? parsed.latestSeq : null;
    } catch {
      return;
    }

    if (!shouldPullForBump(latestSeq, getLastSyncedSeq())) return;
    if (bumpSyncTimerRef.current) {
      clearTimeout(bumpSyncTimerRef.current);
    }
    bumpSyncTimerRef.current = setTimeout(() => {
      bumpSyncTimerRef.current = null;
      if (syncingRef.current || !cloudSyncEnabledRef.current) return;
      lastAutoAttemptAtRef.current = Date.now();
      void syncRef.current();
    }, SYNC_BUMP_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    if (!cloudSyncEnabled || !apiUrl) {
      setConnection("disconnected");
      return;
    }

    const stream = createSyncStream({
      onStateChange: setConnection,
      onMessage: handleSyncStreamMessage,
    });

    const syncStreamVisibility = () => {
      if (document.visibilityState === "visible") {
        stream.start();
      } else {
        stream.stop();
      }
    };

    syncStreamVisibility();
    document.addEventListener("visibilitychange", syncStreamVisibility);

    return () => {
      document.removeEventListener("visibilitychange", syncStreamVisibility);
      stream.stop();
    };
  }, [apiUrl, cloudSyncEnabled, handleSyncStreamMessage]);

  useEffect(() => {
    return () => {
      if (delayedSyncTimerRef.current) {
        clearTimeout(delayedSyncTimerRef.current);
      }
      if (writeSyncTimerRef.current) {
        clearTimeout(writeSyncTimerRef.current);
      }
      if (bumpSyncTimerRef.current) {
        clearTimeout(bumpSyncTimerRef.current);
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
      syncAfterWrite,
      connection,
    }),
    [
      apiUrl,
      cloudSyncEnabled,
      connection,
      setCloudSyncEnabledInContext,
      status,
      syncAfterWrite,
      syncIfStale,
      syncState,
      updateApiUrl,
    ],
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
