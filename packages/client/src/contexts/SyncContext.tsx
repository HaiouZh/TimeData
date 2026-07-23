import { useLiveQuery } from "dexie-react-hooks";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { SyncStreamBumpSchema } from "@timedata/shared";
import { db } from "../db/index.ts";
import { useAppHideFlush } from "../hooks/useAppHideFlush.ts";
import { useAppResumeRefresh } from "../hooks/useAppResumeRefresh.ts";
import { useSync } from "../hooks/useSync.ts";
import { getCloudSyncEnabled, setCloudSyncEnabled } from "../lib/cloudSyncSetting.ts";
import { safeGetItem, safeSetItem } from "../lib/safeStorage.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";
import { createSyncStream, type SyncStreamMessage, type SyncStreamState } from "../lib/syncStream.js";
import { getLastSyncedSeq, stashBumpPayload } from "../sync/engine.ts";
import { type SyncExecutorMeta, syncExecutorSucceeded, syncScheduler } from "../sync/scheduler.ts";

export type SyncStatus = "idle" | "syncing" | "success" | "error" | "disabled" | "pending";

interface DeriveSyncStatusInput {
  cloudSyncEnabled: boolean;
  syncing: boolean;
  error: string | null;
  unsyncedCount: number;
  lastSynced: string | null;
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
  connection: SyncStreamState;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const syncState = useSync({ autoSyncOnMount: false });
  const [apiUrl, setApiUrl] = useState(() => safeGetItem(STORAGE_KEYS.apiUrl) || "");
  const [cloudSyncEnabled, setCloudSyncEnabledState] = useState(getCloudSyncEnabled);
  const [connection, setConnection] = useState<SyncStreamState>("disconnected");
  const liveUnsyncedCount = useLiveQuery(() => db.syncLog.where("synced").equals(0).count(), [], 0);
  const syncRef = useRef(syncState.sync);
  const connectionRef = useRef(connection);
  const lastRunFailedRef = useRef(false);

  useEffect(() => {
    syncRef.current = syncState.sync;
  }, [syncState.sync]);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

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

  useEffect(() => {
    if (!cloudSyncEnabled || !apiUrl) return;
    syncScheduler.setExecutor(async (meta: SyncExecutorMeta) => {
      const outcome = await syncRef.current({ ...meta, connection: connectionRef.current });
      lastRunFailedRef.current = !syncExecutorSucceeded(outcome);
      return outcome;
    });
    // 冷启动首拉不押注 SSE hello：注册即无条件踢一次同步（高延迟链路上 hello 可能几十秒不到甚至不来）
    syncScheduler.requestSync("startup");
    return () => syncScheduler.setExecutor(null);
  }, [cloudSyncEnabled, apiUrl]);

  useAppResumeRefresh(() => syncScheduler.requestSync("resume"));
  useAppHideFlush(() => syncScheduler.flushNow());

  const handleSyncStreamMessage = useCallback((message: SyncStreamMessage) => {
    if (message.event !== "hello" && message.event !== "bump") return;

    let latestSeq: number | null = null;
    try {
      const raw = JSON.parse(message.data) as { latestSeq?: unknown };
      latestSeq = typeof raw.latestSeq === "number" ? raw.latestSeq : null;
      // 载荷解析失败只放弃快路径、不丢通知：新旧版本窗口里 changes 可能含本端不认的域。
      const parsed = SyncStreamBumpSchema.safeParse(raw);
      if (
        message.event === "bump"
        && parsed.success
        && parsed.data.fromSeq != null
        && parsed.data.changes != null
        && typeof parsed.data.latestSeq === "number"
      ) {
        stashBumpPayload({
          fromSeq: parsed.data.fromSeq,
          latestSeq: parsed.data.latestSeq,
          changes: parsed.data.changes,
        });
      }
    } catch {
      return;
    }

    if (!shouldPullForBump(latestSeq, getLastSyncedSeq())) return;
    syncScheduler.requestSync("bump");
  }, []);

  const handleSyncStreamStateChange = useCallback((state: SyncStreamState) => {
    setConnection(state);
    if (state === "connected" && lastRunFailedRef.current) {
      syncScheduler.requestSync("reconnect");
    }
  }, []);

  useEffect(() => {
    if (!cloudSyncEnabled || !apiUrl) {
      setConnection("disconnected");
      return;
    }

    const stream = createSyncStream({
      onStateChange: handleSyncStreamStateChange,
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
  }, [apiUrl, cloudSyncEnabled, handleSyncStreamMessage, handleSyncStreamStateChange]);

  const value = useMemo<SyncContextValue>(
    () => ({
      ...syncState,
      status,
      apiUrl,
      updateApiUrl,
      cloudSyncEnabled,
      setCloudSyncEnabledInContext,
      connection,
    }),
    [apiUrl, cloudSyncEnabled, connection, setCloudSyncEnabledInContext, status, syncState, updateApiUrl],
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
