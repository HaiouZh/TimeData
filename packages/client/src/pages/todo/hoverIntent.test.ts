import { describe, expect, it } from "vitest";
import {
  HOVER_INTENT_MS,
  hoverIntentReducer,
  type HoverIntentState,
  initialHoverIntent,
} from "./hoverIntent.js";

describe("hoverIntentReducer", () => {
  it("point 新候选：记下 pending 与起始时刻，armed 仍为空", () => {
    const next = hoverIntentReducer(initialHoverIntent, { type: "point", id: "a", now: 0 });
    expect(next).toEqual<HoverIntentState>({ pendingId: "a", pendingSince: 0, armedId: null });
  });

  it("重复 point 同一候选：不重置计时（返回同一引用）", () => {
    const s1 = hoverIntentReducer(initialHoverIntent, { type: "point", id: "a", now: 0 });
    const s2 = hoverIntentReducer(s1, { type: "point", id: "a", now: 300 });
    expect(s2).toBe(s1);
  });

  it("tick 未达阈值：保持 pending 不 arm", () => {
    const s1 = hoverIntentReducer(initialHoverIntent, { type: "point", id: "a", now: 0 });
    const s2 = hoverIntentReducer(s1, { type: "tick", now: HOVER_INTENT_MS - 1 });
    expect(s2).toBe(s1);
    expect(s2.armedId).toBeNull();
  });

  it("tick 达阈值：arm 当前候选并清空 pending", () => {
    const s1 = hoverIntentReducer(initialHoverIntent, { type: "point", id: "a", now: 0 });
    const s2 = hoverIntentReducer(s1, { type: "tick", now: HOVER_INTENT_MS });
    expect(s2).toEqual<HoverIntentState>({ pendingId: null, pendingSince: null, armedId: "a" });
  });

  it("已 armed 仍悬停同一目标：保持 armed", () => {
    const armed: HoverIntentState = { pendingId: null, pendingSince: null, armedId: "a" };
    const next = hoverIntentReducer(armed, { type: "point", id: "a", now: 999 });
    expect(next).toBe(armed);
  });

  it("已 armed 移到新目标：立即折叠旧 armed，按新起点为新目标计时", () => {
    const armed: HoverIntentState = { pendingId: null, pendingSince: null, armedId: "a" };
    const next = hoverIntentReducer(armed, { type: "point", id: "b", now: 1000 });
    expect(next).toEqual<HoverIntentState>({ pendingId: "b", pendingSince: 1000, armedId: null });
  });

  it("切换候选会重置计时基准（用新候选的 pendingSince 判定阈值）", () => {
    const s1 = hoverIntentReducer(initialHoverIntent, { type: "point", id: "a", now: 0 });
    const s2 = hoverIntentReducer(s1, { type: "point", id: "b", now: 500 });
    // 距 b 起点仅 100ms，未达阈值
    const s3 = hoverIntentReducer(s2, { type: "tick", now: 600 });
    expect(s3.armedId).toBeNull();
    // 距 b 起点满 600ms 才 arm b（而非 a）
    const s4 = hoverIntentReducer(s2, { type: "tick", now: 500 + HOVER_INTENT_MS });
    expect(s4.armedId).toBe("b");
  });

  it("point(null) 离开所有目标：取消 pending 并折叠 armed", () => {
    const pending = hoverIntentReducer(initialHoverIntent, { type: "point", id: "a", now: 0 });
    expect(hoverIntentReducer(pending, { type: "point", id: null, now: 50 })).toEqual(initialHoverIntent);

    const armed: HoverIntentState = { pendingId: null, pendingSince: null, armedId: "a" };
    expect(hoverIntentReducer(armed, { type: "point", id: null, now: 50 })).toEqual(initialHoverIntent);
  });

  it("point(null) 在空态：返回同一引用（无空转渲染）", () => {
    expect(hoverIntentReducer(initialHoverIntent, { type: "point", id: null, now: 0 })).toBe(initialHoverIntent);
  });

  it("tick 无 pending：保持不变", () => {
    const armed: HoverIntentState = { pendingId: null, pendingSince: null, armedId: "a" };
    expect(hoverIntentReducer(armed, { type: "tick", now: 99999 })).toBe(armed);
    expect(hoverIntentReducer(initialHoverIntent, { type: "tick", now: 99999 })).toBe(initialHoverIntent);
  });

  it("reset：清空到初始态", () => {
    const armed: HoverIntentState = { pendingId: "x", pendingSince: 1, armedId: "a" };
    expect(hoverIntentReducer(armed, { type: "reset" })).toEqual(initialHoverIntent);
    expect(hoverIntentReducer(initialHoverIntent, { type: "reset" })).toBe(initialHoverIntent);
  });
});
