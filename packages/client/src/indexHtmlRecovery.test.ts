import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

  describe("调度器信道配对钩子（ios-instant-open 阶段1 §2.1）", () => {
    const match = html.match(/<script id="td-boot-channel-tap">([\s\S]*?)<\/script>/);

    function runTap(win: Record<string, unknown>): void {
      expect(match).not.toBeNull();
      new Function("window", match?.[1] ?? "")(win);
    }

    class NativeChannel {
      port1 = { side: 1 };
      port2 = { side: 2 };
    }

    // 逃逸变异：钩子改成返回包装对象 → instanceof / 原型不再是原生的。
    it("new 出来的仍是原生实例，并记下 port2 → port1", () => {
      const win: Record<string, unknown> = { MessageChannel: NativeChannel };
      runTap(win);
      const Tapped = win.MessageChannel as unknown as new () => NativeChannel;
      const channel = new Tapped();
      expect(channel).toBeInstanceOf(NativeChannel);
      expect(Object.getPrototypeOf(channel)).toBe(NativeChannel.prototype);
      const boot = win.__timedataBoot as { channelPairs: WeakMap<object, unknown> };
      expect(boot.channelPairs.get(channel.port2)).toBe(channel.port1);
    });

    it("保留已有的 __timedataBoot 字段", () => {
      const win: Record<string, unknown> = { MessageChannel: NativeChannel, __timedataBoot: { other: 1 } };
      runTap(win);
      expect((win.__timedataBoot as { other: number }).other).toBe(1);
    });

    it("宿主没有 MessageChannel 时安静跳过、不建命名空间", () => {
      const win: Record<string, unknown> = {};
      expect(() => runTap(win)).not.toThrow();
      expect(win.__timedataBoot).toBeUndefined();
    });

    // 逃逸变异：给钩子加 type="module" / defer → 变成延后执行，赶不上 scheduler 求值，配对静默失效。
    it("钩子是 classic 内联脚本，入口模块脚本不带 async（时序由 HTML 规范保证，与位置无关）", () => {
      expect(html).toContain('<script id="td-boot-channel-tap">');
      expect(html).toMatch(/<script type="module" src="\/src\/main\.tsx"><\/script>/);
    });
  });
});
