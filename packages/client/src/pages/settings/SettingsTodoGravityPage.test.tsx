// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { click, renderDom } from "../../test/domHarness.tsx";
import { db } from "../../db/index.js";
import { addTask } from "../../lib/tasks.js";
import { getSetting } from "../../lib/settings/index.js";
import { SyncProvider } from "../../contexts/SyncContext.tsx";
import SettingsTodoGravityPage from "./SettingsTodoGravityPage.tsx";

beforeEach(async () => {
  await db.tasks.clear();
  await db.settings.clear();
  await db.syncLog.clear();
});

describe("SettingsTodoGravityPage", () => {
  it("renders title and six controls", async () => {
    const { host, root } = await renderDom(
      createElement(MemoryRouter, null, createElement(SyncProvider, null, createElement(SettingsTodoGravityPage))),
    );
    expect(host.textContent).toContain("水位线与翻牌");
    // 6 controls: enabled switch + 5 number rows
    expect(host.querySelector('[role="switch"]')).not.toBeNull();
    expect(host.textContent).toContain("多少天没动静就沉下去");
    expect(host.textContent).toContain("每顶一次多扛几天");
    expect(host.textContent).toContain("新建保护期");
    expect(host.textContent).toContain("一次备几张牌");
    expect(host.textContent).toContain("一批最多顶几张");
    await act(async () => root.unmount());
  });

  it("toggling enabled writes todo.gravity.v1", async () => {
    const { host, root } = await renderDom(
      createElement(MemoryRouter, null, createElement(SyncProvider, null, createElement(SettingsTodoGravityPage))),
    );

    const toggle = host.querySelector('[role="switch"]') as HTMLButtonElement;
    await click(toggle);
    await act(async () => { await Promise.resolve(); });

    const raw = await getSetting("todo.gravity.v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.enabled).toBe(false);
    await act(async () => root.unmount());
  });

  it("changing drawM below current pickN clamps pickN", async () => {
    const { host, root } = await renderDom(
      createElement(MemoryRouter, null, createElement(SyncProvider, null, createElement(SettingsTodoGravityPage))),
    );

    // drawM 默认 5, pickN 默认 1. 把 drawM 改成 1 → pickN 应被夹到 1.
    const drawMInput = host.querySelector('[aria-label="一次备几张牌"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(drawMInput, "1");
      drawMInput.dispatchEvent(new Event("input", { bubbles: true }));
      drawMInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { await Promise.resolve(); });

    const raw = await getSetting("todo.gravity.v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.drawM).toBe(1);
    expect(parsed.pickN).toBeLessThanOrEqual(parsed.drawM);
    await act(async () => root.unmount());
  });

  it("restore default writes DEFAULT_TODO_GRAVITY_SETTINGS", async () => {
    const { host, root } = await renderDom(
      createElement(MemoryRouter, null, createElement(SyncProvider, null, createElement(SettingsTodoGravityPage))),
    );

    // 先改一个值
    const toggle = host.querySelector('[role="switch"]') as HTMLButtonElement;
    await click(toggle);
    await act(async () => { await Promise.resolve(); });

    // 点恢复默认
    const restoreBtn = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("恢复默认"),
    ) as HTMLButtonElement;
    expect(restoreBtn).toBeTruthy();
    await click(restoreBtn);
    await act(async () => { await Promise.resolve(); });

    const raw = await getSetting("todo.gravity.v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.enabled).toBe(true);
    expect(parsed.waterlineDays).toBe(14);
    expect(parsed.drawM).toBe(5);
    await act(async () => root.unmount());
  });

  it("preview displays X / Y underwater count", async () => {
    await addTask({ title: "新想法", toInbox: true });
    await addTask({ title: "旧想法", toInbox: true, now: new Date("2000-01-01T00:00:00.000Z") });

    const { host, root } = await renderDom(
      createElement(MemoryRouter, null, createElement(SyncProvider, null, createElement(SettingsTodoGravityPage))),
    );

    // 等 liveQuery 渲染
    for (let i = 0; i < 30; i++) {
      if (host.textContent?.includes("1 / 2")) break;
      await act(async () => { await Promise.resolve(); });
    }

    expect(host.textContent).toContain("1 / 2");
    await act(async () => root.unmount());
  });

  it("setting enabled=false makes preview X become 0", async () => {
    await addTask({ title: "旧想法", toInbox: true, now: new Date("2000-01-01T00:00:00.000Z") });

    const { host, root } = await renderDom(
      createElement(MemoryRouter, null, createElement(SyncProvider, null, createElement(SettingsTodoGravityPage))),
    );

    // 等 liveQuery 渲染
    for (let i = 0; i < 30; i++) {
      if (host.textContent?.includes("1 / 1")) break;
      await act(async () => { await Promise.resolve(); });
    }

    expect(host.textContent).toContain("1 / 1");

    // 关闭 enabled
    const toggle = host.querySelector('[role="switch"]') as HTMLButtonElement;
    await click(toggle);
    // 等 settings 写入 + re-render
    for (let i = 0; i < 30; i++) {
      if (host.textContent?.includes("0 / 1")) break;
      await act(async () => { await Promise.resolve(); });
    }

    expect(host.textContent).toContain("0 / 1");
    await act(async () => root.unmount());
  });

  it("keeps number controls editable when waterline is disabled", async () => {
    const { host, root } = await renderDom(
      createElement(MemoryRouter, null, createElement(SyncProvider, null, createElement(SettingsTodoGravityPage))),
    );

    const toggle = host.querySelector('[role="switch"]') as HTMLButtonElement;
    await click(toggle);
    await act(async () => { await Promise.resolve(); });

    const waterlineInput = host.querySelector('[aria-label="多少天没动静就沉下去"]') as HTMLInputElement;
    expect(waterlineInput.disabled).toBe(false);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(waterlineInput, "30");
      waterlineInput.dispatchEvent(new Event("input", { bubbles: true }));
      waterlineInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    let parsed: { enabled: boolean; waterlineDays: number } | null = null;
    for (let i = 0; i < 30; i++) {
      await act(async () => { await Promise.resolve(); });
      const raw = await getSetting("todo.gravity.v1");
      parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.enabled === false && parsed.waterlineDays === 30) break;
    }
    expect(parsed).not.toBeNull();
    expect(parsed.enabled).toBe(false);
    expect(parsed.waterlineDays).toBe(30);
    await act(async () => root.unmount());
  });
});
