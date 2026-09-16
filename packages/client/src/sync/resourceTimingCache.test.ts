import { beforeEach, describe, expect, it } from "vitest";
import {
  installResourceTimingCache,
  latestNetTimingSince,
  latestSyncProtocol,
  netTimingOf,
  recordResourceEntry,
  resetResourceTimingCache,
} from "./resourceTimingCache.js";

function entry(overrides: Partial<Parameters<typeof recordResourceEntry>[0]> = {}) {
  return {
    name: "https://api.example/api/sync/status",
    startTime: 1000,
    connectStart: 1010,
    connectEnd: 1250,
    requestStart: 1250,
    responseStart: 1600,
    responseEnd: 1620,
    nextHopProtocol: "h2",
    ...overrides,
  };
}

beforeEach(resetResourceTimingCache);

describe("netTimingOf", () => {
  it("连接（含 TLS）/ 首字节 / 传输 与连接是否复用", () => {
    expect(netTimingOf(entry())).toEqual({ connectMs: 240, ttfbMs: 350, xferMs: 20, reused: false });
    expect(netTimingOf(entry({ connectStart: 1010, connectEnd: 1010 }))).toMatchObject({ connectMs: 0, reused: true });
  });

  // 逃逸变异：直接透传 0 → 服务端没放行 TAO 时报告里全是「0 ms 连接」，把网络慢伪装成网络快。
  it("跨域未放行 TAO（requestStart 与 responseStart 都为 0）→ 各项 null", () => {
    expect(netTimingOf(entry({ connectStart: 0, connectEnd: 0, requestStart: 0, responseStart: 0 }))).toEqual({
      connectMs: null,
      ttfbMs: null,
      xferMs: null,
      reused: null,
    });
  });

  it("没有条目 → null", () => {
    expect(netTimingOf(undefined)).toBeNull();
  });
});

describe("缓存", () => {
  it("按路径记最近一条；早于会话开始的条目不算", () => {
    recordResourceEntry(entry({ startTime: 500 }));
    expect(latestNetTimingSince("status", 800)).toBeNull();
    recordResourceEntry(entry({ startTime: 900 }));
    expect(latestNetTimingSince("status", 800)).not.toBeNull();
    expect(latestNetTimingSince("pull", 0)).toBeNull();
  });

  it("任一 /api/sync/ 条目带协议就更新协议；非同步请求忽略", () => {
    recordResourceEntry(entry({ name: "https://x/api/other", nextHopProtocol: "http/1.1" }));
    expect(latestSyncProtocol()).toBeUndefined();
    recordResourceEntry(entry({ name: "https://x/api/sync/stream", nextHopProtocol: "h3" }));
    expect(latestSyncProtocol()).toBe("h3");
  });
});

describe("installResourceTimingCache", () => {
  it("宿主没有 PerformanceObserver → false", () => {
    expect(installResourceTimingCache({})).toBe(false);
  });

  it("以 buffered 订阅 resource，观察到的条目进缓存；重复安装返回 false", () => {
    let callback: ((list: { getEntries(): unknown[] }) => void) | null = null;
    let observed: unknown = null;
    class FakeObserver {
      constructor(cb: (list: { getEntries(): unknown[] }) => void) {
        callback = cb;
      }
      observe(options: unknown) {
        observed = options;
      }
    }
    const scope = { PerformanceObserver: FakeObserver as unknown as typeof PerformanceObserver };
    expect(installResourceTimingCache(scope)).toBe(true);
    expect(observed).toEqual({ type: "resource", buffered: true });
    callback?.({ getEntries: () => [entry({ startTime: 2000 })] });
    expect(latestNetTimingSince("status", 1500)).not.toBeNull();
    expect(installResourceTimingCache(scope)).toBe(false);
  });
});
