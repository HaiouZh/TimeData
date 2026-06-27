// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import NoteMeta from "./NoteMeta.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(element: ReactElement): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(element);
  });
  return { host, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("NoteMeta", () => {
  it("renders the local HH:mm time", async () => {
    const { host, root } = await render(
      createElement(NoteMeta, { occurredAt: "2026-06-01T04:08:00.000Z", pending: false }),
    );

    expect(host.textContent).toContain("12:08");
    expect(host.querySelector("span")?.className).toContain("td-time");
    expect(host.querySelector("span")?.className).not.toContain(["font", "mono"].join("-"));

    await act(async () => root.unmount());
  });

  it("labels a clock state while pending", async () => {
    const { host, root } = await render(
      createElement(NoteMeta, { occurredAt: "2026-06-01T04:08:00.000Z", pending: true }),
    );

    expect(host.querySelector('[aria-label="待上传"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="已上传"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it("labels an uploaded state when not pending", async () => {
    const { host, root } = await render(
      createElement(NoteMeta, { occurredAt: "2026-06-01T04:08:00.000Z", pending: false }),
    );

    expect(host.querySelector('[aria-label="已上传"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="待上传"]')).toBeNull();

    await act(async () => root.unmount());
  });
});
