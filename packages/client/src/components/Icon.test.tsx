// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { Icon, resolveIconWeight } from "./Icon.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

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
    const { host, root } = await render(createElement(Icon, { icon: MagnifyingGlass, label: "搜索" }));
    const svg = host.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toBe("搜索");
    expect(svg?.getAttribute("role")).toBe("img");
    await act(async () => root.unmount());
  });
  it("无 label -> svg aria-hidden", async () => {
    const { host, root } = await render(createElement(Icon, { icon: MagnifyingGlass }));
    const svg = host.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    await act(async () => root.unmount());
  });
});
