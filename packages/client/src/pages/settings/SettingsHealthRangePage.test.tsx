// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/index.ts";
import { getSetting } from "../../lib/settings/index.ts";
import { HEALTH_RANGE_PRESETS_KEY } from "../../lib/settings/healthRangeSetting.ts";
import SettingsHealthRangePage from "./SettingsHealthRangePage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  await db.settings.clear();
  await db.syncLog.clear();
});

async function renderPage() {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(SettingsHealthRangePage)));
  });
  return { host, root };
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
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${HEALTH_RANGE_PRESETS_KEY}`);
}

describe("SettingsHealthRangePage", () => {
  it("列出全部健康范围档位", async () => {
    const { host, root } = await renderPage();

    for (const label of ["7天", "30天", "90天", "180天", "365天", "全部"]) {
      expect(inputByLabel(host, label)).toBeTruthy();
    }

    await act(async () => {
      root.unmount();
    });
  });

  it("点掉 7 天后写入设置", async () => {
    const { host, root } = await renderPage();

    await act(async () => {
      inputByLabel(host, "7天").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitForSetting((value) => value != null && !value.split(",").includes("7"));

    await act(async () => {
      root.unmount();
    });
  });
});
