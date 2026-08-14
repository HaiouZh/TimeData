// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.tsx";

/**
 * 打桩 useSettingLoad 精确控制三态。真库读不出「首帧」——`renderDom` 里的 `act` 会把
 * liveQuery 的回流一并 flush 掉，而这里要钉的恰恰是回流**之前**那一帧长什么样。
 */
let mockRaw: string | null | undefined;
vi.mock("./index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./index.js")>()),
  useSettingLoad: () => mockRaw,
}));

const { CONFIGURABLE_TABS, resetTabOrderCache, useVisibleTabs } = await import("./navVisibleTabsSetting.js");

const ONLY_TODO = JSON.stringify(CONFIGURABLE_TABS.map((to) => ({ to, hidden: to !== "/todo" })));

function TabsProbe() {
  return createElement("div", { "data-testid": "tabs" }, useVisibleTabs().join(","));
}

const readTabs = (host: HTMLElement) => host.querySelector('[data-testid="tabs"]')?.textContent;

beforeEach(() => {
  resetTabOrderCache();
  mockRaw = undefined;
});

afterEach(() => {
  resetTabOrderCache();
});

describe("useVisibleTabs 的首帧", () => {
  it("新挂载的底栏不再闪出已隐藏的 tab", async () => {
    // ① 先有一份底栏读到过真实配置（用户只留了「待办」）。
    mockRaw = ONLY_TODO;
    const first = await renderDom(createElement(TabsProbe));
    expect(readTabs(first.host)).toBe("/todo");

    // ② iOS 切 tab 会新挂载一层、也就新挂载一份底栏，它的 liveQuery 首帧必然还没回流。
    mockRaw = undefined;
    const second = await renderDom(createElement(TabsProbe));

    // 修复前这里是全量 7 个 tab——用户隐藏掉的那些会闪出来再收回去。
    expect(readTabs(second.host)).toBe("/todo");

    await unmount(first.root);
    await unmount(second.root);
  });

  it("从没读到过配置时仍按全量默认渲染，不是空底栏", async () => {
    mockRaw = undefined;
    const { host, root } = await renderDom(createElement(TabsProbe));

    expect(readTabs(host)).toBe([...CONFIGURABLE_TABS].join(","));
    await unmount(root);
  });

  // 缓存是进程内的，清库的测试必须一并清它——否则上个用例的配置会在下个用例的首帧复活
  // （SettingsNavPage 的开关测试就这么超时过：初始态反了，点击变成了反向操作）。
  it("resetTabOrderCache 把首帧交回全量默认", async () => {
    mockRaw = ONLY_TODO;
    const seeded = await renderDom(createElement(TabsProbe));
    expect(readTabs(seeded.host)).toBe("/todo");

    resetTabOrderCache();
    mockRaw = undefined;
    const fresh = await renderDom(createElement(TabsProbe));

    expect(readTabs(fresh.host)).toBe([...CONFIGURABLE_TABS].join(","));
    await unmount(seeded.root);
    await unmount(fresh.root);
  });
});
