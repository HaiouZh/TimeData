import { describe, expect, it } from "vitest";
import { SMOOTH_RUN_SCREENS, planScrollToLatest } from "./scrollToLatest.js";

// 容器 800 高、内容 5000 高 → 底部 scrollTop = 4200。
const metrics = (scrollTop: number) => ({ scrollTop, scrollHeight: 5000, clientHeight: 800 });

describe("planScrollToLatest", () => {
  it("离底不到两屏：不瞬移，直接平滑滚到底", () => {
    expect(planScrollToLatest(metrics(4200 - 800), { reducedMotion: false })).toEqual({
      jumpTo: null,
      smoothTo: 4200,
    });
  });

  it("恰好两屏也算近：仍全程平滑", () => {
    expect(planScrollToLatest(metrics(4200 - 2 * 800), { reducedMotion: false })).toEqual({
      jumpTo: null,
      smoothTo: 4200,
    });
  });

  it("离底超过两屏：先瞬移到离底两屏处，再平滑滚完最后两屏——动画时长不随距离拖长", () => {
    expect(SMOOTH_RUN_SCREENS).toBe(2);
    expect(planScrollToLatest(metrics(0), { reducedMotion: false })).toEqual({
      jumpTo: 4200 - 2 * 800,
      smoothTo: 4200,
    });
  });

  it("减弱动态效果：一步瞬移到底，不做任何平滑", () => {
    expect(planScrollToLatest(metrics(0), { reducedMotion: true })).toEqual({ jumpTo: 4200, smoothTo: null });
    expect(planScrollToLatest(metrics(4000), { reducedMotion: true })).toEqual({ jumpTo: 4200, smoothTo: null });
  });

  it("内容不足一屏（没有可滚距离）：目标就是 0，不会算出负数", () => {
    expect(planScrollToLatest({ scrollTop: 0, scrollHeight: 300, clientHeight: 800 }, { reducedMotion: false })).toEqual(
      { jumpTo: null, smoothTo: 0 },
    );
  });
});
