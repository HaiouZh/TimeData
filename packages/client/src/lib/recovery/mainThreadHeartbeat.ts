/**
 * 主线程心跳：每 intervalMs 跳一拍，记录「这一拍比预期晚了多少」的最大值。
 *
 * 用途只有一个：探针超时时分辨「线程被冻 / App 被挂起」与「线程空着、只是调度器不干活」——
 * 前者 maxGapMs ≈ waitedMs，后者 ≈ 0。只在探针挂着的几秒内跑，平时不开。
 */
export interface Heartbeat {
  /** 到目前为止最大的一次迟到毫秒（含「上一拍到现在」这段，判定时刻正冻着也算得到）。 */
  maxGapMs(): number;
  stop(): void;
}

export function startHeartbeat(intervalMs: number, now: () => number = Date.now): Heartbeat {
  let last = now();
  let maxGap = 0;
  let stopped = false;
  const timer = setInterval(() => {
    const t = now();
    maxGap = Math.max(maxGap, t - last - intervalMs);
    last = t;
  }, intervalMs);
  return {
    maxGapMs: () => {
      // 上一拍到现在这段也算：判定时刻正冻着，最后一拍还没来得及跑。
      const trailing = stopped ? 0 : now() - last - intervalMs;
      return Math.max(0, Math.round(Math.max(maxGap, trailing)));
    },
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
