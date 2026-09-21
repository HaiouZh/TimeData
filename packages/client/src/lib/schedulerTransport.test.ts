import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRANSPORT_FALLBACK_MS,
  deliveredSince,
  drainSchedulerTransport,
  hasSchedulerTransport,
  installSchedulerTransportPolicy,
  kickSchedulerTransport,
  pendingMessageMs,
  resetSchedulerTransport,
  type SchedulerTransportCore,
  schedulerDeliveryState,
  transportState,
} from "./schedulerTransport.ts";

/** 假机制层：只记调用、不真投递。`schedule()` 入队并触发策略钩，`deliver()` 模拟信道送达。 */
function fakeCore() {
  let queued = 0;
  let clock = 100;
  const core = {
    gen: 1,
    posted: 0,
    delivered: 0,
    ran: 0,
    lastPostedAt: null as number | null,
    lastDeliveredAt: null as number | null,
    dead: false,
    onSchedule: null as (() => void) | null,
    onDeliver: null as (() => void) | null,
    rotate: vi.fn(() => {
      core.gen += 1;
      core.dead = false;
    }),
    drain: vi.fn(() => {
      const n = queued;
      queued = 0;
      core.ran += n;
      return n;
    }),
    cancel: vi.fn(),
    queued: () => queued,
    portDead: () => core.dead,
    snapshot: () => ({
      gen: core.gen,
      posted: core.posted,
      delivered: core.delivered,
      ran: core.ran,
      queued,
      lastPostedAt: core.lastPostedAt,
      lastDeliveredAt: core.lastDeliveredAt,
    }),
    schedule: vi.fn((_fn: (...args: unknown[]) => void): number => {
      queued += 1;
      core.posted += 1;
      core.lastPostedAt = clock;
      core.onSchedule?.();
      return core.posted;
    }),
    deliver() {
      core.delivered += 1;
      core.lastDeliveredAt = clock;
      core.onDeliver?.();
      core.ran += queued;
      queued = 0;
    },
    tick(ms: number) {
      clock += ms;
    },
  };
  return core;
}

type Listener = () => void;
function fakeScope(core: ReturnType<typeof fakeCore>) {
  const docListeners = new Map<string, Set<Listener>>();
  const winListeners = new Map<string, Set<Listener>>();
  const add = (map: Map<string, Set<Listener>>) => (type: string, fn: Listener) => {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type)?.add(fn);
  };
  const remove = (map: Map<string, Set<Listener>>) => (type: string, fn: Listener) => {
    map.get(type)?.delete(fn);
  };
  const fire = (map: Map<string, Set<Listener>>, type: string) => {
    for (const fn of map.get(type) ?? []) fn();
  };
  const document = { visibilityState: "visible" as DocumentVisibilityState, addEventListener: add(docListeners), removeEventListener: remove(docListeners) };
  const window = { addEventListener: add(winListeners), removeEventListener: remove(winListeners) };
  return {
    scope: {
      __timedataBoot: { schedulerTransport: core as unknown as SchedulerTransportCore },
      document: document as unknown as Document,
      window: window as unknown as Window,
    },
    document,
    visible() {
      document.visibilityState = "visible";
      fire(docListeners, "visibilitychange");
    },
    hidden() {
      document.visibilityState = "hidden";
      fire(docListeners, "visibilitychange");
    },
    focus: () => fire(winListeners, "focus"),
    pageshow: () => fire(winListeners, "pageshow"),
    listenerCount: () => [...docListeners.values(), ...winListeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetSchedulerTransport();
});
afterEach(() => {
  resetSchedulerTransport();
  vi.useRealTimers();
});

describe("未安装（钩子没装上 / 测试环境）", () => {
  it("全部退化为 no-op，状态可读且 installed:false", () => {
    expect(installSchedulerTransportPolicy({})).toBe(false);
    expect(hasSchedulerTransport()).toBe(false);
    expect(kickSchedulerTransport()).toBe(false);
    expect(drainSchedulerTransport()).toBe(false);
    expect(schedulerDeliveryState()).toEqual({ installed: false, lastPostedAt: null, lastDeliveredAt: null });
    expect(transportState()).toMatchObject({ installed: false, mode: "suspect", gen: 0, rotations: 0, fallbacks: 0, deadPorts: 0 });
  });
});

describe("三态策略", () => {
  it("接管后挂上两枚钩；同一 core 重复接管返回 false", () => {
    const core = fakeCore();
    const { scope } = fakeScope(core);
    expect(installSchedulerTransportPolicy(scope)).toBe(true);
    expect(typeof core.onSchedule).toBe("function");
    expect(typeof core.onDeliver).toBe("function");
    expect(installSchedulerTransportPolicy(scope)).toBe(false);
    expect(hasSchedulerTransport()).toBe(true);
    expect(transportState()).toMatchObject({ installed: true, mode: "suspect", gen: 1 });
  });

  // 真闸：suspect 下每次排队都挂一枚定时器的话，定时器会成堆；送达后不清的话会误换道。
  it("suspect：排队只挂一枚兜底；送达即 confirmed 并清掉它", () => {
    const core = fakeCore();
    installSchedulerTransportPolicy(fakeScope(core).scope);
    core.schedule(() => {});
    core.schedule(() => {});
    expect(vi.getTimerCount()).toBe(1);
    core.deliver();
    expect(transportState().mode).toBe("confirmed");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(TRANSPORT_FALLBACK_MS * 2);
    expect(core.rotate).not.toHaveBeenCalled();
    expect(core.drain).not.toHaveBeenCalled();
    // confirmed 下排队零定时器
    core.schedule(() => {});
    expect(vi.getTimerCount()).toBe(0);
  });

  it("兜底到点信道没送达 → 换新信道、直排积压、进 degraded；degraded 下每次排队至多一枚 setTimeout(0)", () => {
    const core = fakeCore();
    installSchedulerTransportPolicy(fakeScope(core).scope);
    core.schedule(() => {});
    vi.advanceTimersByTime(TRANSPORT_FALLBACK_MS);
    expect(core.rotate).toHaveBeenCalledTimes(1);
    expect(core.drain).toHaveBeenCalledTimes(1);
    expect(transportState()).toMatchObject({ mode: "degraded", fallbacks: 1, rotations: 1, gen: 2 });

    core.schedule(() => {});
    core.schedule(() => {});
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(0);
    expect(core.drain).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("兜底到点但队已空（信道其实送达了）→ 什么都不做", () => {
    const core = fakeCore();
    installSchedulerTransportPolicy(fakeScope(core).scope);
    core.schedule(() => {});
    core.drain(); // 有人（比如看门狗）已把队排空，但没走 deliver
    core.drain.mockClear();
    vi.advanceTimersByTime(TRANSPORT_FALLBACK_MS);
    expect(core.rotate).not.toHaveBeenCalled();
    expect(core.drain).not.toHaveBeenCalled();
    expect(transportState().fallbacks).toBe(0);
  });

  it("degraded 下信道再次送达 → 回 confirmed", () => {
    const core = fakeCore();
    installSchedulerTransportPolicy(fakeScope(core).scope);
    core.schedule(() => {});
    vi.advanceTimersByTime(TRANSPORT_FALLBACK_MS);
    expect(transportState().mode).toBe("degraded");
    core.deliver();
    expect(transportState().mode).toBe("confirmed");
  });

  it("回前台：confirmed 降为 suspect；队里有东西就立刻挂兜底", () => {
    const core = fakeCore();
    const f = fakeScope(core);
    installSchedulerTransportPolicy(f.scope);
    core.schedule(() => {});
    core.deliver();
    expect(transportState().mode).toBe("confirmed");

    f.visible();
    expect(transportState().mode).toBe("suspect");
    expect(vi.getTimerCount()).toBe(0);

    core.schedule(() => {});
    core.deliver();
    core.schedule(() => {}); // confirmed 下排队不挂定时器
    expect(vi.getTimerCount()).toBe(0);
    f.visible(); // 但回前台时队里还有东西 → 立刻挂
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(TRANSPORT_FALLBACK_MS);
    expect(core.rotate).toHaveBeenCalledTimes(1);
  });

  // 真闸：去掉 portDead 分支 → 死端口要多等一个兜底窗口，且现场没有 deadPorts 这条根因证据。
  it("回前台发现 port1.onmessage 被清空 → 立即换道、计 deadPorts", () => {
    const core = fakeCore();
    const f = fakeScope(core);
    installSchedulerTransportPolicy(f.scope);
    core.schedule(() => {});
    core.deliver();
    core.dead = true;
    f.visible();
    expect(core.rotate).toHaveBeenCalledTimes(1);
    expect(transportState()).toMatchObject({ mode: "suspect", deadPorts: 1, rotations: 1 });
  });

  it("degraded 下回前台顺手换新信道；转后台事件不算回前台", () => {
    const core = fakeCore();
    const f = fakeScope(core);
    installSchedulerTransportPolicy(f.scope);
    core.schedule(() => {});
    vi.advanceTimersByTime(TRANSPORT_FALLBACK_MS);
    expect(core.rotate).toHaveBeenCalledTimes(1);
    f.hidden();
    expect(core.rotate).toHaveBeenCalledTimes(1);
    f.visible();
    expect(core.rotate).toHaveBeenCalledTimes(2);
    expect(transportState().mode).toBe("degraded");
  });

  it("focus / pageshow 同样算回前台", () => {
    const core = fakeCore();
    const f = fakeScope(core);
    installSchedulerTransportPolicy(f.scope);
    core.schedule(() => {});
    core.deliver();
    f.focus();
    expect(transportState().mode).toBe("suspect");
    core.schedule(() => {});
    core.deliver();
    f.pageshow();
    expect(transportState().mode).toBe("suspect");
  });

  it("看门狗补拍：换道 + 直排 + degraded；直驱：只直排", () => {
    const core = fakeCore();
    installSchedulerTransportPolicy(fakeScope(core).scope);
    core.schedule(() => {});
    core.deliver();
    expect(kickSchedulerTransport()).toBe(true);
    expect(core.rotate).toHaveBeenCalledTimes(1);
    expect(core.drain).toHaveBeenCalledTimes(1);
    expect(transportState()).toMatchObject({ mode: "degraded", rotations: 1 });
    expect(drainSchedulerTransport()).toBe(true);
    expect(core.drain).toHaveBeenCalledTimes(2);
    expect(core.rotate).toHaveBeenCalledTimes(1);
  });

  it("送达状态读自机制层快照", () => {
    const core = fakeCore();
    installSchedulerTransportPolicy(fakeScope(core).scope);
    core.schedule(() => {});
    expect(schedulerDeliveryState()).toEqual({ installed: true, lastPostedAt: 100, lastDeliveredAt: null });
    core.tick(7);
    core.deliver();
    expect(schedulerDeliveryState()).toEqual({ installed: true, lastPostedAt: 100, lastDeliveredAt: 107 });
  });

  it("reset：清定时器、退订回前台、解开钩", () => {
    const core = fakeCore();
    const f = fakeScope(core);
    installSchedulerTransportPolicy(f.scope);
    core.schedule(() => {});
    expect(vi.getTimerCount()).toBe(1);
    resetSchedulerTransport();
    expect(vi.getTimerCount()).toBe(0);
    expect(f.listenerCount()).toBe(0);
    expect(core.onSchedule).toBeNull();
    expect(core.onDeliver).toBeNull();
    f.visible();
    expect(core.rotate).not.toHaveBeenCalled();
  });
});

describe("送达判定助手", () => {
  const base = { installed: true, lastPostedAt: 100, lastDeliveredAt: 90 };

  it("deliveredSince：送达时间不早于基准才算", () => {
    expect(deliveredSince({ ...base, lastDeliveredAt: 120 }, 110)).toBe(true);
    expect(deliveredSince({ ...base, lastDeliveredAt: 110 }, 110)).toBe(true);
    expect(deliveredSince({ ...base, lastDeliveredAt: 109 }, 110)).toBe(false);
    expect(deliveredSince({ ...base, lastDeliveredAt: null }, 110)).toBe(false);
  });

  it("pendingMessageMs：排队后没送达 → 已挂多久；送达不早于排队 → 0；未安装或未排队 → null", () => {
    expect(pendingMessageMs(base, 400)).toBe(300);
    expect(pendingMessageMs({ ...base, lastDeliveredAt: 100 }, 400)).toBe(0);
    expect(pendingMessageMs({ ...base, installed: false }, 400)).toBeNull();
    expect(pendingMessageMs({ ...base, lastPostedAt: null }, 400)).toBeNull();
  });
});

describe("scheduler 的信道选择形态", () => {
  /**
   * 真闸：整套换道押在「scheduler 求值时有 setImmediate 就用它、不再自建 MessageChannel」这一形态上。
   * React 若改了选择顺序，钩子装了也没人用，换道静默失效——直接读 `scheduler` 产物钉死。dev 与 production 两份都验。
   */
  it.each([
    "scheduler/cjs/scheduler.development.js",
    "scheduler/cjs/scheduler.production.js",
  ])("%s 优先用 setImmediate 排队", (file) => {
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve(file), "utf8");
    expect(source).toMatch(/typeof setImmediate/);
    const viaSetImmediate = source.indexOf("localSetImmediate(performWorkUntilDeadline)");
    const viaChannel = source.indexOf("new MessageChannel()");
    expect(viaSetImmediate).toBeGreaterThan(-1);
    expect(viaChannel).toBeGreaterThan(-1);
    expect(viaSetImmediate).toBeLessThan(viaChannel);
  });
});
