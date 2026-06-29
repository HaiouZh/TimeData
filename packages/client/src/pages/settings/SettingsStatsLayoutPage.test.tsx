// @vitest-environment jsdom
// biome-ignore-all assist/source/organizeImports: dbReset 必须最先求值（先注册 fake-indexeddb 再 import db 单例）；
// 若被 import 排序挪到 lib/settings（其 import db/index）之后，db/index 会在 fake-idb 注册前捕获到 undefined → MissingAPIError。
import { resetDb } from "../../test/dbReset.ts";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { getSetting } from "../../lib/settings/index.ts";
import { click, renderDom, unmount } from "../../test/domHarness.tsx";
import SettingsStatsLayoutPage from "./SettingsStatsLayoutPage.tsx";

beforeEach(resetDb);

async function waitForLayout(expected: (layout: { order?: string[]; hidden?: string[] }) => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const raw = await getSetting("stats.layout.v1");
    const layout = raw ? (JSON.parse(raw) as { order?: string[]; hidden?: string[] }) : {};
    if (expected(layout)) return;
    // setTimeout(0)：让位给 Dexie 持久化的宏任务边界，非真实计时等待。
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for stats.layout.v1");
}

async function renderPage() {
  return await renderDom(createElement(MemoryRouter, null, createElement(SettingsStatsLayoutPage)));
}

describe("SettingsStatsLayoutPage", () => {
  it("列出全部模块标题", async () => {
    const { host, root } = await renderPage();
    for (const title of ["总览", "作息", "异常与空挡", "趋势变化", "结构诊断"]) {
      expect(host.textContent).toContain(title);
    }
    await unmount(root);
  });

  it("隐藏某模块写入 layout，hidden 含该 id", async () => {
    const { host, root } = await renderPage();
    const toggle = host.querySelector('[role="switch"][aria-label="显示 总览"]');
    await click(toggle);

    await waitForLayout((layout) => layout.hidden?.includes("overview") ?? false);

    await unmount(root);
  });

  it("点上移改变 order", async () => {
    const { host, root } = await renderPage();
    const upRoutine = host.querySelector('[aria-label="上移 作息"]');
    await click(upRoutine);

    await waitForLayout((layout) => layout.order?.[0] === "routine");

    await unmount(root);
  });

  it("重置恢复默认顺序", async () => {
    const { host, root } = await renderPage();
    const upRoutine = host.querySelector('[aria-label="上移 作息"]');
    await click(upRoutine);
    await waitForLayout((layout) => layout.order?.[0] === "routine");

    const reset = host.querySelector("button:last-child");
    await click(reset);
    await waitForLayout((layout) => layout.order?.[0] === "overview");

    await unmount(root);
  });
});
