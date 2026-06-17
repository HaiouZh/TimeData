// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/index.ts";
import { getSetting } from "../../lib/settings/index.ts";
import SettingsStatsLayoutPage from "./SettingsStatsLayoutPage.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  await db.settings.clear();
  await db.syncLog.clear();
});

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
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(SettingsStatsLayoutPage)));
  });
  return { host, root };
}

describe("SettingsStatsLayoutPage", () => {
  it("列出全部模块标题", async () => {
    const { host, root } = await renderPage();
    for (const title of ["总览", "作息", "异常与空挡", "趋势变化", "结构诊断"]) {
      expect(host.textContent).toContain(title);
    }
    await act(async () => {
      root.unmount();
    });
  });

  it("隐藏某模块写入 layout，hidden 含该 id", async () => {
    const { host, root } = await renderPage();
    const toggle = host.querySelector('[role="switch"][aria-label="显示 总览"]');
    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitForLayout((layout) => layout.hidden?.includes("overview") ?? false);

    await act(async () => {
      root.unmount();
    });
  });

  it("点上移改变 order", async () => {
    const { host, root } = await renderPage();
    const upRoutine = host.querySelector('[aria-label="上移 作息"]');
    await act(async () => {
      upRoutine?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitForLayout((layout) => layout.order?.[0] === "routine");

    await act(async () => {
      root.unmount();
    });
  });

  it("重置恢复默认顺序", async () => {
    const { host, root } = await renderPage();
    const upRoutine = host.querySelector('[aria-label="上移 作息"]');
    await act(async () => {
      upRoutine?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForLayout((layout) => layout.order?.[0] === "routine");

    const reset = host.querySelector("button:last-child");
    await act(async () => {
      reset?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForLayout((layout) => layout.order?.[0] === "overview");

    await act(async () => {
      root.unmount();
    });
  });
});
