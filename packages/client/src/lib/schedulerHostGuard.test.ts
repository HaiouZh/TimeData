import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installSchedulerPortTap,
  kickScheduler,
  resetSchedulerPortTap,
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

describe("调度器的调用形态", () => {
  /**
   * 真闸：整套补拍机制押在「调度器用 `postMessage(null)` 排队」这一形态上。React 若改了它，
   * 端口就再也记不到，补拍静默失效而没有任何报错——这里直接读 `scheduler` 产物钉死这个前提。
   */
  it("scheduler 仍以 postMessage(null) 排队", () => {
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve("scheduler/cjs/scheduler.development.js"), "utf8");

    expect(source).toMatch(/port\w*\.postMessage\(null\)/);
  });
});
