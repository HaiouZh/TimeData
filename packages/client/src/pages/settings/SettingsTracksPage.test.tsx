// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/index.js";
import { readTrackActionTags, setTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { SettingsTracksPage } from "./SettingsTracksPage.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

beforeEach(async () => {
  await db.open();
  await db.settings.clear();
  await db.syncLog.clear();
});
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

async function renderPage() {
  mounted = await renderDom(createElement(MemoryRouter, null, createElement(SettingsTracksPage)));
  return mounted.host;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitForTags(predicate: (tags: string[]) => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (predicate(await readTrackActionTags())) return;
    await flush();
  }
  throw new Error("Timed out waiting for track.actionTags.v2");
}

async function fillInput(host: HTMLElement, value: string): Promise<void> {
  const input = host.querySelector('input[aria-label="新增看板信号"]') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitForm(host: HTMLElement): Promise<void> {
  await act(async () => {
    (host.querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("SettingsTracksPage", () => {
  it("shows the default board signal tags when nothing is configured", async () => {
    const host = await renderPage();
    await flush();
    expect(host.textContent).toContain("轨道看板信号");
    expect(host.textContent).toContain("配置会进入轨道列表顶部聚合的步骤标签。");
    expect(host.textContent).toContain("待我处理");
    expect(host.textContent).toContain("agent在做");
    expect(host.textContent).not.toContain("等我");
    expect(host.textContent).not.toContain("待决策");
    expect(host.textContent).not.toContain("阵营");
    expect(host.querySelector('[role="radiogroup"]')).toBeNull();
  });

  it("adds a new board signal via the input form", async () => {
    const host = await renderPage();
    await flush();
    await fillInput(host, "需我确认");
    await submitForm(host);
    await waitForTags((tags) => tags.includes("需我确认"));
  });

  it("removes an existing board signal", async () => {
    await setTrackActionTags(["待我处理", "agent在做"]);
    const host = await renderPage();
    await waitForTags((tags) => tags.length === 2);
    await click(host.querySelector('button[aria-label="删除 待我处理"]'));
    await waitForTags((tags) => tags.length === 1 && tags[0] === "agent在做");
  });

  it("does not add duplicate or empty board signals", async () => {
    await setTrackActionTags(["待我处理"]);
    const host = await renderPage();
    await flush();
    await fillInput(host, " 待我处理 ");
    await submitForm(host);
    await fillInput(host, "   ");
    await submitForm(host);
    await expect(readTrackActionTags()).resolves.toEqual(["待我处理"]);
  });
});
