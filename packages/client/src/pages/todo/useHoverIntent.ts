import { useCallback, useEffect, useReducer } from "react";
import { HOVER_INTENT_MS, hoverIntentReducer, initialHoverIntent } from "./hoverIntent.js";

export interface HoverIntent {
  /** 当前被激活展开的目标 root id（无则 null）。 */
  armedId: string | null;
  /** 指针当前悬停的候选 root id（离开所有目标传 null）。 */
  point: (id: string | null) => void;
  /** 拖拽结束/取消时清空。 */
  reset: () => void;
}

/**
 * 悬停意图 hook：包一层 {@link hoverIntentReducer}。
 * pending 期间挂一次性 timer 复查阈值；阈值的最终判据在 reducer（用真实 now），
 * 因此 timer 早晚都不影响正确性。切换候选（pendingSince 变）会重启 timer。
 */
export function useHoverIntent(): HoverIntent {
  const [state, dispatch] = useReducer(hoverIntentReducer, initialHoverIntent);

  // pendingSince 只随 pendingId 一起变（切换候选才更新），故仅依赖 pendingId 即可重启计时。
  useEffect(() => {
    if (state.pendingId === null) return;
    const timer = setTimeout(() => dispatch({ type: "tick", now: Date.now() }), HOVER_INTENT_MS);
    return () => clearTimeout(timer);
  }, [state.pendingId]);

  const point = useCallback((id: string | null) => dispatch({ type: "point", id, now: Date.now() }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  return { armedId: state.armedId, point, reset };
}
