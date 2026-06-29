// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";
import NoteMeta from "./NoteMeta.js";

describe("NoteMeta", () => {
  it("renders the local HH:mm time", async () => {
    const { host, root } = await renderDom(
      createElement(NoteMeta, { occurredAt: "2026-06-01T04:08:00.000Z", pending: false }),
    );

    expect(host.textContent).toContain("12:08");
    expect(host.querySelector("span")?.className).toContain("td-time");
    expect(host.querySelector("span")?.className).not.toContain(["font", "mono"].join("-"));

    await unmount(root);
  });

  it("labels a clock state while pending", async () => {
    const { host, root } = await renderDom(
      createElement(NoteMeta, { occurredAt: "2026-06-01T04:08:00.000Z", pending: true }),
    );

    expect(host.querySelector('[aria-label="待上传"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="已上传"]')).toBeNull();

    await unmount(root);
  });

  it("labels an uploaded state when not pending", async () => {
    const { host, root } = await renderDom(
      createElement(NoteMeta, { occurredAt: "2026-06-01T04:08:00.000Z", pending: false }),
    );

    expect(host.querySelector('[aria-label="已上传"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="待上传"]')).toBeNull();

    await unmount(root);
  });
});
