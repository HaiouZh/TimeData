// @vitest-environment jsdom
import { act, createElement, useContext } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/frontendUpdate.ts", () => ({
  CURRENT_BUILD_ID: "current-test",
  hardRefresh: vi.fn(),
  hasFrontendUpdate: vi.fn(),
}));

import { AppUpdateContext, AppUpdateProvider } from "./appUpdate.js";
import { hardRefresh, hasFrontendUpdate } from "./lib/frontendUpdate.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

let captured: { currentBuildId: string; forceRefresh: () => void } | null = null;

function Probe() {
  captured = useContext(AppUpdateContext);
  return null;
}

describe("AppUpdateProvider version check", () => {
  beforeEach(() => {
    vi.mocked(hasFrontendUpdate).mockReset();
    vi.mocked(hardRefresh).mockReset();
    captured = null;
    setVisibility("visible");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("hard-refreshes when a newer build is detected on visibility", async () => {
    vi.mocked(hasFrontendUpdate).mockResolvedValue(true);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => root.render(createElement(AppUpdateProvider, null, createElement(Probe))));
    await flush();

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();

    expect(vi.mocked(hardRefresh)).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("does not refresh when build is current", async () => {
    vi.mocked(hasFrontendUpdate).mockResolvedValue(false);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => root.render(createElement(AppUpdateProvider, null, createElement(Probe))));
    await flush();

    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await flush();

    expect(vi.mocked(hardRefresh)).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("exposes currentBuildId and a forceRefresh that hard-refreshes", async () => {
    vi.mocked(hasFrontendUpdate).mockResolvedValue(false);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => root.render(createElement(AppUpdateProvider, null, createElement(Probe))));
    await flush();

    expect(captured?.currentBuildId).toBe("current-test");
    await act(async () => captured?.forceRefresh());
    await flush();

    expect(vi.mocked(hardRefresh)).toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
