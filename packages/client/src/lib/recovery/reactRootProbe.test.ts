// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.tsx";
import { TRANSITION_LANES_MASK, snapshotReactRoot } from "./reactRootProbe.ts";

function fakeContainer(stateNode: unknown): Element {
  return { "__reactContainer$abc123": { stateNode } } as unknown as Element;
}

describe("snapshotReactRoot", () => {
  it("读出 lanes 原值与两个布尔旗", () => {
    const snapshot = snapshotReactRoot(
      fakeContainer({ pendingLanes: 512, suspendedLanes: 512, pingedLanes: 0, callbackNode: null, cancelPendingCommit: null }),
    );
    expect(snapshot).toEqual({ p: 512, s: 512, pg: 0, cb: false, cpc: false });
  });

  it("有排着的调度任务 / 提交在等资源 → 对应旗为 true", () => {
    const snapshot = snapshotReactRoot(
      fakeContainer({ pendingLanes: 0, suspendedLanes: 0, pingedLanes: 0, callbackNode: {}, cancelPendingCommit: () => {} }),
    );
    expect(snapshot).toMatchObject({ cb: true, cpc: true });
  });

  // 逃逸变异：去掉 try → 取值抛错外泄到看门狗的自救路径。
  it("结构异常一律 null，绝不抛", () => {
    expect(snapshotReactRoot(null)).toBeNull();
    expect(snapshotReactRoot({} as Element)).toBeNull();
    expect(snapshotReactRoot(fakeContainer(undefined))).toBeNull();
    expect(snapshotReactRoot(fakeContainer({ pendingLanes: "1", suspendedLanes: 0, pingedLanes: 0 }))).toBeNull();
    const throwing = {};
    Object.defineProperty(throwing, "pendingLanes", {
      get() {
        throw new Error("boom");
      },
    });
    expect(() => snapshotReactRoot(fakeContainer(throwing))).not.toThrow();
    expect(snapshotReactRoot(fakeContainer(throwing))).toBeNull();
  });

  it("真实 React 根上取得到快照（dev 构建）", async () => {
    const { host, root } = await renderDom(createElement("div"));
    const snapshot = snapshotReactRoot(host);
    expect(snapshot).not.toBeNull();
    expect(typeof snapshot?.p).toBe("number");
    await unmount(root);
  });
});

describe("React 根快照的形态闸", () => {
  /**
   * 真闸：快照读的是 FiberRoot 内部字段与容器键，React 升级改名后快照恒为 null / 旗恒 false，
   * 甲乙判定静默失效。线上跑的是 production 产物，直接读它钉住全部字面量。
   */
  it("react-dom-client.production.js 仍含快照依赖的全部字面量与 transition 掩码", () => {
    const require = createRequire(import.meta.url);
    const file = join(dirname(require.resolve("react-dom/package.json")), "cjs/react-dom-client.production.js");
    const source = readFileSync(file, "utf8");
    for (const needle of [
      '"__reactContainer$"',
      "this.pendingLanes =",
      "this.suspendedLanes =",
      "this.pingedLanes =",
      "this.callbackNode =",
      "this.cancelPendingCommit =",
      `lanes & ${TRANSITION_LANES_MASK}`,
    ]) {
      expect(source, needle).toContain(needle);
    }
  });
});
