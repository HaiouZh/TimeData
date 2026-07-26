// @vitest-environment jsdom
import { createElement, useEffect } from "react";
import { describe, expect, it } from "vitest";
import { renderDom } from "./domHarness.js";

// unit 桶 afterEach 的 React root 卸载契约回归测试（与 mockResetContract.test.ts 同类）。
//
// 背景：setup.ts 的 afterEach 曾只做 document.body.innerHTML = ""。清空 body 只是摘掉节点，
// React root 仍挂着——组件连同它的 useLiveQuery 订阅永久留活。页面级用例把 unmount(root)
// 写在最后一句，任一断言先失败就走不到，之后每条用例开头的 db.*.clear() 都会驱动这些僵尸页
// 重渲染；实测在 TodoPage.test.tsx 上，故意红 3 条会让一条毫不相干的重规模用例跟着超时红，
// 把排查引向没被改过的代码。
//
// 本文件按声明顺序跑：A 留一个未 unmount 的 root，B 断言它已被卸掉。
// 关键是断言 effect cleanup 跑过而不是 body 空了——清 innerHTML 也能让 body 空，
// 但跑不了 React 的卸载路径。撤掉 setup.ts 里的 cleanupRoots()，B 必红。

const effectCleanups: string[] = [];

function Probe() {
  useEffect(
    () => () => {
      effectCleanups.push("unmounted");
    },
    [],
  );
  return createElement("div", null, "probe");
}

describe("unit 桶 afterEach 的 React root 卸载契约", () => {
  it("A：渲染后不手动 unmount（模拟断言先失败、末行 unmount(root) 走不到）", async () => {
    const { host } = await renderDom(createElement(Probe));

    expect(host.textContent).toContain("probe");
    expect(effectCleanups).toHaveLength(0);
  });

  it("B：afterEach 应真把它卸了——effect cleanup 跑过（只清 body.innerHTML 做不到）", () => {
    expect(effectCleanups).toEqual(["unmounted"]);
  });
});
