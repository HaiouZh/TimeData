import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliveredSince,
  driveSchedulerDirectly,
  hasSchedulerPort,
  installSchedulerPortTap,
  kickScheduler,
  pendingMessageMs,
  resetSchedulerPortTap,
  schedulerDeliveryState,
} from "./schedulerHostGuard.ts";

interface StubPort extends MessagePort {
  /** 本端口自己收到的消息。**每个端口一份**——共用一个收件箱就分辨不出补拍补给了谁，闸会变假。 */
  inbox: unknown[];
}

/** 造一个能挂原型钩子的最小 MessagePort 族：node 的真实 MessagePort 会拖住事件循环。 */
function createPortStub() {
  class FakeMessagePort {
    inbox: unknown[] = [];
    postMessage(message: unknown): void {
      this.inbox.push(message);
    }
  }
  return {
    scope: { MessagePort: FakeMessagePort as unknown as typeof MessagePort },
    makePort: () => new FakeMessagePort() as unknown as StubPort,
  };
}

beforeEach(resetSchedulerPortTap);
afterEach(resetSchedulerPortTap);

describe("installSchedulerPortTap", () => {
  it("挂钩后不改变投递行为，原消息照常送出", () => {
    const { scope, makePort } = createPortStub();
    expect(installSchedulerPortTap(scope)).toBe(true);

    const a = makePort();
    const b = makePort();
    a.postMessage(null);
    b.postMessage("hello");

    expect(a.inbox).toEqual([null]);
    expect(b.inbox).toEqual(["hello"]);
  });

  it("幂等：重复安装不再叠加一层钩子", () => {
    const { scope } = createPortStub();
    expect(installSchedulerPortTap(scope)).toBe(true);
    expect(installSchedulerPortTap(scope)).toBe(false);
  });

  it("宿主没有 MessagePort 时安静跳过", () => {
    expect(installSchedulerPortTap({})).toBe(false);
  });
});

describe("kickScheduler", () => {
  it("补拍发给最近一个以 null 排队的端口——调度器的调用形态", () => {
    const { scope, makePort } = createPortStub();
    installSchedulerPortTap(scope);
    const schedulerPort = makePort();

    schedulerPort.postMessage(null);
    schedulerPort.inbox.length = 0;

    expect(kickScheduler()).toBe(true);
    expect(schedulerPort.inbox).toEqual([null]);
  });

  // 真闸：不按形态过滤的话，页面里别的 MessageChannel 使用方（workbox 等）会把记录顶掉，
  // 补拍补到无关端口上——调度器依旧卡死，而我们以为已经救过了。
  it("非 null 的投递不顶掉记录，补拍仍落在调度器端口上", () => {
    const { scope, makePort } = createPortStub();
    installSchedulerPortTap(scope);
    const schedulerPort = makePort();
    const workboxPort = makePort();

    schedulerPort.postMessage(null);
    workboxPort.postMessage({ type: "WORKBOX" });
    schedulerPort.inbox.length = 0;
    workboxPort.inbox.length = 0;

    expect(kickScheduler()).toBe(true);
    expect(schedulerPort.inbox).toEqual([null]);
    expect(workboxPort.inbox).toEqual([]);
  });

  it("还没记到端口时报告补不出去，让调用方走最后手段", () => {
    expect(kickScheduler()).toBe(false);
  });

  it("投递抛错算补不出去，不外泄异常", () => {
    const scope = {
      MessagePort: class {
        postMessage(): void {
          throw new Error("port closed");
        }
      } as unknown as typeof MessagePort,
    };
    installSchedulerPortTap(scope);
    // 钩子先记端口再转发，故这一句虽然抛错，端口已经记下了；调用方的异常不被吞掉是对的。
    expect(() => new scope.MessagePort().postMessage(null)).toThrow("port closed");

    // 而补拍是我们自己发起的，抛错只该转成「没补成」，不能外泄。
    expect(() => kickScheduler()).not.toThrow();
    expect(kickScheduler()).toBe(false);
  });
});

describe("hasSchedulerPort", () => {
  // 真闸：过滤条件若从 === null 松成 == null，无参 / undefined 的投递会被记成调度器端口，补拍就补到无关端口上。
  it("只认 null 这一形态：无参与 undefined 的投递不记端口", () => {
    const { scope, makePort } = createPortStub();
    installSchedulerPortTap(scope);
    const other = makePort();
    other.postMessage(undefined);
    (other.postMessage as unknown as () => void)();
    expect(hasSchedulerPort()).toBe(false);
    expect(kickScheduler()).toBe(false);
    expect(other.inbox).toEqual([undefined, undefined]);
  });

  it("记到端口前为 false，记到后为 true，且查询本身不投递", () => {
    const { scope, makePort } = createPortStub();
    installSchedulerPortTap(scope);
    expect(hasSchedulerPort()).toBe(false);

    const schedulerPort = makePort();
    schedulerPort.postMessage(null);
    expect(hasSchedulerPort()).toBe(true);
    // 只查不发：收件箱仍只有调度器自己那一条
    expect(schedulerPort.inbox).toEqual([null]);
  });
});

describe("调度器的调用形态", () => {
  /**
   * 真闸：整套补拍机制押在「调度器用 `postMessage(null)` 排队」这一形态上。React 若改了它，
   * 端口就再也记不到，补拍静默失效而没有任何报错——这里直接读 `scheduler` 产物钉死这个前提。
   * dev 与 production 由不同构建路径产出，线上跑的是 production 那份，两份都要验。
   */
  it.each([
    "scheduler/cjs/scheduler.development.js",
    "scheduler/cjs/scheduler.production.js",
  ])("%s 仍以 postMessage(null) 排队", (file) => {
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve(file), "utf8");

    expect(source).toMatch(/port\w*\.postMessage\(null\)/);
  });
});

/** 带配对表的端口族：port1 有 onmessage，port2 负责排队。postMessage 不真投递，由用例手动调 onmessage 模拟送达。 */
function createPairedChannel() {
  class FakeMessagePort {
    inbox: unknown[] = [];
    onmessage: ((this: MessagePort, event: MessageEvent) => unknown) | null = null;
    postMessage(message: unknown): void {
      this.inbox.push(message);
    }
  }
  const port1 = new FakeMessagePort() as unknown as MessagePort;
  const port2 = new FakeMessagePort() as unknown as MessagePort;
  const handler = vi.fn();
  port1.onmessage = handler;
  const scope = {
    MessagePort: FakeMessagePort as unknown as typeof MessagePort,
    __timedataBoot: { channelPairs: new WeakMap<object, MessagePort>([[port2, port1]]) },
  };
  return { scope, port1, port2, handler };
}

describe("送达记账（ios-instant-open 阶段1 §2.2）", () => {
  it("未安装时：未配对、两个时间都为 null", () => {
    expect(schedulerDeliveryState()).toEqual({ paired: false, lastPostedAt: null, lastDeliveredAt: null });
  });

  it("以 null 排队记 lastPostedAt，并按配对表包一层 port1.onmessage", () => {
    const { scope, port1, port2, handler } = createPairedChannel();
    let t = 100;
    installSchedulerPortTap(scope, { now: () => t });
    port2.postMessage(null);
    expect(schedulerDeliveryState()).toEqual({ paired: true, lastPostedAt: 100, lastDeliveredAt: null });

    t = 130;
    const event = { data: null } as MessageEvent;
    port1.onmessage?.call(port1, event);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
    expect(schedulerDeliveryState().lastDeliveredAt).toBe(130);
  });

  it("没有配对表：照常记端口与排队时间，paired 为 false", () => {
    const { scope, port2 } = createPairedChannel();
    installSchedulerPortTap({ MessagePort: scope.MessagePort }, { now: () => 7 });
    port2.postMessage(null);
    expect(schedulerDeliveryState()).toEqual({ paired: false, lastPostedAt: 7, lastDeliveredAt: null });
    expect(hasSchedulerPort()).toBe(true);
  });

  it("port1 没有处理函数：不配对、不抛", () => {
    const { scope, port1, port2 } = createPairedChannel();
    port1.onmessage = null;
    installSchedulerPortTap(scope, { now: () => 1 });
    expect(() => port2.postMessage(null)).not.toThrow();
    expect(schedulerDeliveryState().paired).toBe(false);
  });

  // 逃逸变异：直驱调 port1.onmessage（包装函数）而不是原处理函数 → lastDeliveredAt 被刷新，甲的判据失效。
  it("直驱调原处理函数一次，且不刷新 lastDeliveredAt", () => {
    const { scope, port2, handler } = createPairedChannel();
    installSchedulerPortTap(scope, { now: () => 50 });
    port2.postMessage(null);
    const tasks: Array<() => void> = [];
    expect(driveSchedulerDirectly((task) => tasks.push(task))).toBe(true);
    expect(handler).not.toHaveBeenCalled(); // 排进宏任务，不同步调
    for (const task of tasks) task();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(schedulerDeliveryState().lastDeliveredAt).toBeNull();
  });

  // 逃逸变异：去掉 originalHandlers 查询 → 再次配对把包装函数当原处理函数记下，直驱就会刷新送达时间。
  it("配对状态被清后再次排队，不会把包装函数当成原处理函数", () => {
    const { scope, port2, handler } = createPairedChannel();
    installSchedulerPortTap(scope, { now: () => 5 });
    port2.postMessage(null);
    // 模拟「别的端口以 null 排队顶掉了记录，调度器端口又回来」
    const other = new (scope.MessagePort as unknown as new () => MessagePort)();
    other.postMessage(null);
    port2.postMessage(null);
    const tasks: Array<() => void> = [];
    driveSchedulerDirectly((task) => tasks.push(task));
    for (const task of tasks) task();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(schedulerDeliveryState().lastDeliveredAt).toBeNull();
  });

  it("未配对时直驱返回 false、不排任务", () => {
    const schedule = vi.fn();
    expect(driveSchedulerDirectly(schedule)).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("直驱时处理函数抛错被吞，不外泄", () => {
    const { scope, port1, port2 } = createPairedChannel();
    port1.onmessage = () => {
      throw new Error("boom");
    };
    installSchedulerPortTap(scope, { now: () => 1 });
    port2.postMessage(null);
    const tasks: Array<() => void> = [];
    driveSchedulerDirectly((task) => tasks.push(task));
    expect(() => {
      for (const task of tasks) task();
    }).not.toThrow();
  });

  it("reset 清掉送达状态", () => {
    const { scope, port2 } = createPairedChannel();
    installSchedulerPortTap(scope, { now: () => 9 });
    port2.postMessage(null);
    resetSchedulerPortTap();
    expect(schedulerDeliveryState()).toEqual({ paired: false, lastPostedAt: null, lastDeliveredAt: null });
  });
});

describe("送达判定助手", () => {
  const base = { paired: true, lastPostedAt: 100, lastDeliveredAt: 90 };

  it("deliveredSince：送达时间不早于基准才算", () => {
    expect(deliveredSince({ ...base, lastDeliveredAt: 120 }, 110)).toBe(true);
    expect(deliveredSince({ ...base, lastDeliveredAt: 110 }, 110)).toBe(true);
    expect(deliveredSince({ ...base, lastDeliveredAt: 109 }, 110)).toBe(false);
    expect(deliveredSince({ ...base, lastDeliveredAt: null }, 110)).toBe(false);
  });

  it("pendingMessageMs：排队后没投递 → 已挂多久；投递不早于排队 → 0；未配对或未排队 → null", () => {
    expect(pendingMessageMs(base, 400)).toBe(300);
    expect(pendingMessageMs({ ...base, lastDeliveredAt: 100 }, 400)).toBe(0);
    expect(pendingMessageMs({ ...base, paired: false }, 400)).toBeNull();
    expect(pendingMessageMs({ ...base, lastPostedAt: null }, 400)).toBeNull();
  });
});
