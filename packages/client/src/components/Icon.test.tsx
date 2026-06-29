// @vitest-environment jsdom

import { MagnifyingGlass } from "@phosphor-icons/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";
import { Icon, resolveIconWeight } from "./Icon.js";

afterEach(() => vi.restoreAllMocks());

describe("resolveIconWeight", () => {
  it("size>16 默认 light", () => {
    expect(resolveIconWeight(18)).toBe("light");
    expect(resolveIconWeight(24)).toBe("light");
  });
  it("size<=16 默认降 regular", () => {
    expect(resolveIconWeight(16)).toBe("regular");
    expect(resolveIconWeight(12)).toBe("regular");
  });
  it("显式 weight 优先", () => {
    expect(resolveIconWeight(24, "bold")).toBe("bold");
    expect(resolveIconWeight(12, "light")).toBe("light");
  });
});

describe("Icon", () => {
  it("有 label -> svg 带 aria-label 且 role=img", async () => {
    const { host, root } = await renderDom(createElement(Icon, { icon: MagnifyingGlass, label: "搜索" }));
    const svg = host.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toBe("搜索");
    expect(svg?.getAttribute("role")).toBe("img");
    await unmount(root);
  });
  it("无 label -> svg aria-hidden", async () => {
    const { host, root } = await renderDom(createElement(Icon, { icon: MagnifyingGlass }));
    const svg = host.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    await unmount(root);
  });
});
