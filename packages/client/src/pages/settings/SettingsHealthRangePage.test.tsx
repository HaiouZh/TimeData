// @vitest-environment jsdom

import { act, createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { HEALTH_RANGE_PRESETS_KEY } from "../../lib/settings/healthRangeSetting.ts";
import { getSetting } from "../../lib/settings/index.ts";
import { resetDb } from "../../test/dbReset.ts";
import { renderDom, unmount } from "../../test/domHarness.tsx";
import SettingsHealthRangePage from "./SettingsHealthRangePage.js";

beforeEach(resetDb);

async function renderPage() {
  return await renderDom(createElement(MemoryRouter, null, createElement(SettingsHealthRangePage)));
}

function inputByLabel(host: HTMLElement, label: string): HTMLInputElement {
  const labels = [...host.querySelectorAll("label")];
  const match = labels.find((el) => el.textContent === label);
  const input = match?.querySelector('input[type="checkbox"]');
  if (!(input instanceof HTMLInputElement)) throw new Error(`input not found: ${label}`);
  return input;
}

async function waitForSetting(expected: (value: string | null) => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const value = await getSetting(HEALTH_RANGE_PRESETS_KEY);
    if (expected(value)) return;
    // setTimeout(0)：让位给 Dexie 持久化的宏任务边界，非真实计时等待。
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${HEALTH_RANGE_PRESETS_KEY}`);
}

describe("SettingsHealthRangePage", () => {
  it("列出全部健康范围档位", async () => {
    const { host, root } = await renderPage();

    for (const label of ["7天", "30天", "90天", "180天", "365天", "全部"]) {
      expect(inputByLabel(host, label)).toBeTruthy();
    }

    await unmount(root);
  });

  it("点掉 7 天后写入设置", async () => {
    const { host, root } = await renderPage();

    await act(async () => {
      inputByLabel(host, "7天").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitForSetting((value) => value != null && !value.split(",").includes("7"));

    await unmount(root);
  });
});
