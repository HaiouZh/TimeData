// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, it } from "vitest";
import { db } from "../../../db/index.ts";
import { getSetting } from "../../../lib/settings/index.ts";
import TrendSection from "./TrendSection.tsx";
import { makeStatsProps } from "./testFixtures.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  await db.settings.clear();
  await db.syncLog.clear();
});

async function waitForSetting(key: string, expected: (raw: string | null) => boolean): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const raw = await getSetting(key);
    if (expected(raw)) return;
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${key}`);
}

describe("TrendSection", () => {
  it("点击近30天后写入 stats.module.trend.v1", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(TrendSection, makeStatsProps()));
    });

    const preset30 = [...host.querySelectorAll("button")].find((button) => button.textContent === "近30天");
    await act(async () => {
      preset30?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitForSetting("stats.module.trend.v1", (raw) => raw?.includes('"days":30') ?? false);

    await act(async () => {
      root.unmount();
    });
  });
});
