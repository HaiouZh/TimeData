import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const kb = vi.hoisted(() => ({ height: 0, settled: 0, visible: false }));

vi.mock("./useKeyboardHeight.js", () => ({
  useKeyboardHeight: () => kb.height,
  useKeyboardHeightSettled: () => kb.settled,
  useKeyboardVisible: () => kb.visible,
}));

import { useBottomInset } from "./useBottomInset.js";

const INPUT = { barPx: 60, barPxWhileKeyboard: 100, navOffsetBasePx: 49 };

function Probe({ input }: { input: typeof INPUT }) {
  const r = useBottomInset(input);
  return createElement("div", {
    "data-immediate": String(r.immediatePx),
    "data-settled": String(r.settledPx),
    "data-visible": String(r.keyboardVisible),
  });
}

function render(input: typeof INPUT): { immediate: number; settled: number; visible: boolean } {
  const html = renderToStaticMarkup(createElement(Probe, { input }));
  const get = (name: string): string => {
    const m = new RegExp(`data-${name}="([^"]*)"`).exec(html);
    if (!m) throw new Error(`missing data-${name} in ${html}`);
    return m[1];
  };
  return { immediate: Number(get("immediate")), settled: Number(get("settled")), visible: get("visible") === "true" };
}

describe("useBottomInset", () => {
  it("键盘不在场：两侧都计 nav、bar 取 barPx", () => {
    kb.height = 0;
    kb.settled = 0;
    kb.visible = false;
    expect(render(INPUT)).toEqual({ immediate: 109, settled: 109, visible: false });
  });

  it("native 动画期：即时侧已让 nav、吃 WhileKeyboard；settled 侧还按不在场算（零布局）", () => {
    kb.height = 300;
    kb.settled = 0;
    kb.visible = true;
    expect(render(INPUT)).toEqual({ immediate: 400, settled: 109, visible: true });
  });

  it("壳让位：在场但高度恒 0，settled 侧也按在场算", () => {
    kb.height = 0;
    kb.settled = 0;
    kb.visible = true;
    expect(render(INPUT)).toEqual({ immediate: 100, settled: 100, visible: true });
  });
});
