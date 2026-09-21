import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// 行尾归一见 indexCssTokens.test.ts：仓库在 Windows 上检出会带 CRLF，正则里的 \n 匹配不到。
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("index.html 恢复期兜底", () => {
  it("内联底色，覆盖重载到 React 挂载的全程", () => {
    // index.css 的 body 没有 background——底色来自 React 根节点的 bg-page。
    // iOS 回收 WKWebView 渲染进程后会整页重载，React 挂载前那几百毫秒会是系统默认白。
    // 这条断言守的就是那段兜底样式，删掉即白屏回归。
    expect(html).toMatch(/<style>[\s\S]*?html\s*,\s*body\s*\{[\s\S]*?background:\s*#0e1320/);
  });

  it("内联预连接，让跨太平洋握手与 JS 解析并行", () => {
    expect(html).toContain("timedata_api_url");
    expect(html).toContain('"preconnect"');
  });

  describe("调度器换道钩子（ios-instant-open 阶段2 §3.1）", () => {
    const match = html.match(/<script id="td-boot-scheduler-transport">([\s\S]*?)<\/script>/);

    interface FakePort {
      onmessage: ((event: { data: unknown }) => void) | null;
      outbox: unknown[];
      closed: boolean;
      postMessage(message: unknown): void;
      close(): void;
    }
    interface FakeChannel {
      port1: FakePort;
      port2: FakePort;
    }
    interface Transport {
      schedule(fn: (...args: unknown[]) => void, ...args: unknown[]): number;
      cancel(id: number): void;
      rotate(): void;
      drain(): number;
      queued(): number;
      portDead(): boolean;
      snapshot(): {
        gen: number;
        posted: number;
        delivered: number;
        ran: number;
        queued: number;
        lastPostedAt: number | null;
        lastDeliveredAt: number | null;
      };
      onSchedule: (() => void) | null;
      onDeliver: (() => void) | null;
    }

    /** 假 window：channel 不真投递，`deliver()` 把最新 channel 的 port2 出件逐条送到 port1.onmessage。 */
    function createFakeWindow() {
      const channels: FakeChannel[] = [];
      const timers: Array<{ fn: () => void; ms: number }> = [];
      let clock = 1000;
      class Port implements FakePort {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        outbox: unknown[] = [];
        closed = false;
        postMessage(message: unknown): void {
          if (this.closed) throw new Error("port closed");
          this.outbox.push(message);
        }
        close(): void {
          this.closed = true;
        }
      }
      class MessageChannel implements FakeChannel {
        port1 = new Port();
        port2 = new Port();
        constructor() {
          channels.push(this);
        }
      }
      const win: Record<string, unknown> = {
        MessageChannel,
        performance: { now: () => clock },
        setTimeout: (fn: () => void, ms: number) => {
          timers.push({ fn, ms });
          return timers.length;
        },
      };
      const latest = () => channels[channels.length - 1];
      const deliver = () => {
        const channel = latest();
        while (channel.port2.outbox.length > 0) {
          channel.port2.outbox.shift();
          channel.port1.onmessage?.({ data: null });
        }
      };
      const transport = () => (win.__timedataBoot as { schedulerTransport: Transport }).schedulerTransport;
      return { win, channels, timers, latest, deliver, transport, tick: (ms: number) => (clock += ms) };
    }

    function runHook(win: Record<string, unknown>): void {
      expect(match).not.toBeNull();
      new Function("window", match?.[1] ?? "")(win);
    }

    it("装上 setImmediate / clearImmediate，建一条 channel 并把 wake 挂在 port1 上", () => {
      const f = createFakeWindow();
      runHook(f.win);
      expect(typeof f.win.setImmediate).toBe("function");
      expect(typeof f.win.clearImmediate).toBe("function");
      expect(f.channels).toHaveLength(1);
      expect(typeof f.latest().port1.onmessage).toBe("function");
      expect(f.transport().snapshot()).toEqual({
        gen: 1,
        posted: 0,
        delivered: 0,
        ran: 0,
        queued: 0,
        lastPostedAt: null,
        lastDeliveredAt: null,
      });
    });

    it("宿主已有 setImmediate 或没有 MessageChannel → 整段跳过、不建命名空间", () => {
      const existing = () => 0;
      const a: Record<string, unknown> = { MessageChannel: class {}, setImmediate: existing, performance: { now: () => 0 } };
      runHook(a);
      expect(a.setImmediate).toBe(existing);
      expect(a.__timedataBoot).toBeUndefined();

      const b: Record<string, unknown> = { performance: { now: () => 0 } };
      expect(() => runHook(b)).not.toThrow();
      expect(b.setImmediate).toBeUndefined();
      expect(b.__timedataBoot).toBeUndefined();
    });

    it("保留已有的 __timedataBoot 字段", () => {
      const f = createFakeWindow();
      f.win.__timedataBoot = { other: 1 };
      runHook(f.win);
      expect((f.win.__timedataBoot as { other: number }).other).toBe(1);
      expect(f.transport()).toBeDefined();
    });

    it("排队即 post 一条 wake；送达后按序跑、参数透传、计数与时刻跟上", () => {
      const f = createFakeWindow();
      runHook(f.win);
      const setImmediate = f.win.setImmediate as (fn: (...a: unknown[]) => void, ...a: unknown[]) => number;
      const ran: unknown[] = [];
      const id1 = setImmediate((...a) => ran.push(["a", ...a]), 1, 2);
      const id2 = setImmediate(() => ran.push(["b"]));
      expect(id1).not.toBe(id2);
      expect(f.latest().port2.outbox).toEqual([null, null]);
      expect(f.transport().snapshot()).toMatchObject({ posted: 2, delivered: 0, ran: 0, queued: 2, lastPostedAt: 1000 });

      f.tick(5);
      f.deliver();
      expect(ran).toEqual([["a", 1, 2], ["b"]]);
      expect(f.transport().snapshot()).toMatchObject({ posted: 2, delivered: 2, ran: 2, queued: 0, lastDeliveredAt: 1005 });
    });

    // 真闸：wake 若把「跑的过程中新入队」的项也一并跑掉，就等于吃掉了调度器的让出——
    // performWorkUntilDeadline 每片结束都重新排队，连着跑就是把整段 transition 同步跑完。
    it("wake 只跑那一刻已在队里的项，期间新入队的留给它自己的 wake", () => {
      const f = createFakeWindow();
      runHook(f.win);
      const setImmediate = f.win.setImmediate as (fn: () => void) => number;
      const ran: string[] = [];
      setImmediate(() => {
        ran.push("a");
        setImmediate(() => ran.push("b"));
      });
      const channel = f.latest();
      channel.port2.outbox.shift();
      channel.port1.onmessage?.({ data: null });
      expect(ran).toEqual(["a"]);
      expect(f.transport().queued()).toBe(1);
      expect(channel.port2.outbox).toEqual([null]);
      f.deliver();
      expect(ran).toEqual(["a", "b"]);
    });

    it("clearImmediate 取消还没跑的项，queued 不再算它", () => {
      const f = createFakeWindow();
      runHook(f.win);
      const setImmediate = f.win.setImmediate as (fn: () => void) => number;
      const clearImmediate = f.win.clearImmediate as (id: number) => void;
      const ran: string[] = [];
      const id = setImmediate(() => ran.push("a"));
      setImmediate(() => ran.push("b"));
      clearImmediate(id);
      expect(f.transport().queued()).toBe(1);
      f.deliver();
      expect(ran).toEqual(["b"]);
    });

    it("单项抛错不阻塞其余，错误在 setTimeout(0) 里异步重抛", () => {
      const f = createFakeWindow();
      runHook(f.win);
      const setImmediate = f.win.setImmediate as (fn: () => void) => number;
      const ran: string[] = [];
      const boom = new Error("boom");
      setImmediate(() => {
        throw boom;
      });
      setImmediate(() => ran.push("b"));
      expect(() => f.deliver()).not.toThrow();
      expect(ran).toEqual(["b"]);
      expect(f.timers).toHaveLength(1);
      expect(f.timers[0].ms).toBe(0);
      expect(() => f.timers[0].fn()).toThrow(boom);
    });

    it("rotate：关旧端口、新建 channel、gen+1；队里有东西才再 post 一条", () => {
      const f = createFakeWindow();
      runHook(f.win);
      const old = f.latest();
      f.transport().rotate();
      expect(old.port1.closed).toBe(true);
      expect(old.port2.closed).toBe(true);
      expect(f.channels).toHaveLength(2);
      expect(f.transport().snapshot().gen).toBe(2);
      expect(f.latest().port2.outbox).toEqual([]);

      const setImmediate = f.win.setImmediate as (fn: () => void) => number;
      const ran: string[] = [];
      setImmediate(() => ran.push("a"));
      f.transport().rotate();
      expect(f.transport().snapshot().gen).toBe(3);
      expect(f.latest().port2.outbox).toEqual([null]);
      f.deliver();
      expect(ran).toEqual(["a"]);
    });

    it("post 抛错（端口已关）不外泄，项仍在队里等 drain", () => {
      const f = createFakeWindow();
      runHook(f.win);
      f.latest().port2.close();
      const setImmediate = f.win.setImmediate as (fn: () => void) => number;
      const ran: string[] = [];
      expect(() => setImmediate(() => ran.push("a"))).not.toThrow();
      expect(f.transport().queued()).toBe(1);
      expect(f.transport().drain()).toBe(1);
      expect(ran).toEqual(["a"]);
      expect(f.transport().snapshot()).toMatchObject({ delivered: 0, ran: 1, queued: 0 });
    });

    it("portDead 读 port1.onmessage 是否被清空——WebKit 断连时会把它清掉", () => {
      const f = createFakeWindow();
      runHook(f.win);
      expect(f.transport().portDead()).toBe(false);
      f.latest().port1.onmessage = null;
      expect(f.transport().portDead()).toBe(true);
      f.transport().rotate();
      expect(f.transport().portDead()).toBe(false);
    });

    it("策略钩 onSchedule / onDeliver 在排队与送达时各被调一次，钩子抛错不影响投递", () => {
      const f = createFakeWindow();
      runHook(f.win);
      const t = f.transport();
      const onSchedule = vi.fn(() => {
        throw new Error("hook");
      });
      const onDeliver = vi.fn();
      t.onSchedule = onSchedule;
      t.onDeliver = onDeliver;
      const ran: string[] = [];
      expect(() => (f.win.setImmediate as (fn: () => void) => number)(() => ran.push("a"))).not.toThrow();
      expect(onSchedule).toHaveBeenCalledTimes(1);
      f.deliver();
      expect(onDeliver).toHaveBeenCalledTimes(1);
      expect(ran).toEqual(["a"]);
    });

    // 逃逸变异：给钩子加 type="module" / defer → 变成延后执行，赶不上 scheduler 求值，setImmediate 装晚了静默失效。
    it("钩子是 classic 内联脚本，入口模块脚本不带 async（时序由 HTML 规范保证，与位置无关）", () => {
      expect(html).toContain('<script id="td-boot-scheduler-transport">');
      expect(html).not.toMatch(/<script id="td-boot-scheduler-transport"[^>]*(type|src|async|defer)/);
      expect(html).toMatch(/<script type="module" src="\/src\/main\.tsx"><\/script>/);
    });
  });
});
