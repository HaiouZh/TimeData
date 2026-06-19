/**
 * 悬停意图（hover-intent）纯状态机。
 *
 * 拖拽一个根任务时，把它悬停在另一个根任务行上达到阈值会"激活"（arm）该目标，
 * 由宿主据此强制展开目标行的子任务区、提供 parent 落点。本模块只管纯逻辑：
 * 候选切换、阈值判定、折叠/重置；真实计时由宿主用一次性 timer 周期性派发 `tick`，
 * 阈值的最终判据仍在这里（reducer 用真实 `now` 复核），timer 早晚都不影响正确性。
 */

/** 悬停达到此毫秒数才激活目标（自动展开）。 */
export const HOVER_INTENT_MS = 600;

export interface HoverIntentState {
  /** 当前正在计时的候选目标 root id（尚未到阈值）。 */
  pendingId: string | null;
  /** 进入 pendingId 的时刻（ms）；切换候选才更新，重复悬停不重置。 */
  pendingSince: number | null;
  /** 已达阈值、被激活展开的目标 root id。 */
  armedId: string | null;
}

export const initialHoverIntent: HoverIntentState = {
  pendingId: null,
  pendingSince: null,
  armedId: null,
};

export type HoverIntentAction =
  | { type: "point"; id: string | null; now: number }
  | { type: "tick"; now: number }
  | { type: "reset" };

export function hoverIntentReducer(state: HoverIntentState, action: HoverIntentAction): HoverIntentState {
  switch (action.type) {
    case "point": {
      const { id, now } = action;
      if (id === null) {
        // 离开所有目标：取消计时并折叠已展开目标。
        return state.pendingId === null && state.armedId === null ? state : initialHoverIntent;
      }
      // 仍悬停在已激活目标上：保持展开。
      if (id === state.armedId) return state;
      // 同一候选：计时继续，不重置基准。
      if (id === state.pendingId) return state;
      // 新候选：立即折叠旧 armed，为新目标重新计时。
      return { pendingId: id, pendingSince: now, armedId: null };
    }
    case "tick": {
      if (state.pendingId === null || state.pendingSince === null) return state;
      if (action.now - state.pendingSince < HOVER_INTENT_MS) return state;
      return { pendingId: null, pendingSince: null, armedId: state.pendingId };
    }
    case "reset":
      return state.pendingId === null && state.pendingSince === null && state.armedId === null
        ? state
        : initialHoverIntent;
    default:
      return state;
  }
}
