import { createContext, useContext, type ReactNode } from "react";
import { useTrackAttentionCount } from "../hooks/useTrackAttentionCount.js";

// 默认 0：无 Provider 时（如只渲染导航组件的单测）读到 0，不显 badge、不触 db。
// 真实应用在 App 默认导出里挂 Provider（Router + SyncProvider 之下，db 可用）。
// 导出裸 context 供测试直接注入固定值，绕开 db。
export const TrackAttentionContext = createContext<number>(0);

export function TrackAttentionProvider({ children }: { children: ReactNode }) {
  const count = useTrackAttentionCount();
  return <TrackAttentionContext.Provider value={count}>{children}</TrackAttentionContext.Provider>;
}

export function useTrackAttentionBadge(): number {
  return useContext(TrackAttentionContext);
}
