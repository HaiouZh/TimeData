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
  throw new Error("Timed out waiting for track.actionTags.v1");
}

describe("SettingsTracksPage", () => {
  it("shows the seed defaults when nothing is configured", async () => {
    const host = await renderPage();
    await flush();
    expect(host.textContent).toContain("等我");
    expect(host.textContent).toContain("待决策");
    expect(host.textContent).toContain("卡住");
  });

  it("adds a new action tag via the input form", async () => {
    const host = await renderPage();
    await flush();
    const input = host.querySelector('input[aria-label="新增行动标签"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setValue?.call(input, "需我确认");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (host.querySelector("form") as HTMLFormElement).dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await waitForTags((tags) => tags.includes("需我确认"));
  });

  it("removes an existing action tag", async () => {
    await setTrackActionTags(["等我", "卡住"]);
    const host = await renderPage();
    await waitForTags((tags) => tags.length === 2);
    await click(host.querySelector('button[aria-label="删除 等我"]'));
    await waitForTags((tags) => tags.length === 1 && tags[0] === "卡住");
  });
});
