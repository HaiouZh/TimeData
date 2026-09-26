import type { AdminOffsiteBackupResponse } from "@timedata/shared";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAppResumeRefresh } from "../hooks/useAppResumeRefresh.js";
import { fetchOffsiteBackupStatus } from "../lib/adminApi.js";
import { useSyncContext } from "./SyncContext.js";

// 回前台的 focus / visibilitychange 很密，冷备一天才推一次，10 分钟内不重复拉。
const REFRESH_MIN_INTERVAL_MS = 10 * 60 * 1000;

// 默认 null：无 Provider（只渲染导航的单测）或没配服务器时不显示任何东西。
// 导出裸 context 供测试直接注入固定值，绕开网络。
export const OffsiteBackupContext = createContext<AdminOffsiteBackupResponse | null>(null);

export function OffsiteBackupProvider({ children }: { children: ReactNode }) {
  const { apiUrl } = useSyncContext();
  const [status, setStatus] = useState<AdminOffsiteBackupResponse | null>(null);
  const lastFetchAt = useRef(0);

  const refresh = useCallback(async () => {
    lastFetchAt.current = Date.now();
    try {
      setStatus(await fetchOffsiteBackupStatus());
    } catch {
      // 旧版服务端（404）、agent token（403）、离线：静默，不出红点也不打扰
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!apiUrl) {
      setStatus(null);
      return;
    }
    void refresh();
  }, [apiUrl, refresh]);

  useAppResumeRefresh(() => {
    if (!apiUrl || Date.now() - lastFetchAt.current < REFRESH_MIN_INTERVAL_MS) return;
    void refresh();
  });

  return <OffsiteBackupContext.Provider value={status}>{children}</OffsiteBackupContext.Provider>;
}

export function useOffsiteBackupStatus(): AdminOffsiteBackupResponse | null {
  return useContext(OffsiteBackupContext);
}

/** 设置入口是否挂红点：只有 failed / stale 报警。 */
export function useOffsiteBackupAlert(): boolean {
  const verdict = useOffsiteBackupStatus()?.verdict;
  return verdict === "failed" || verdict === "stale";
}
