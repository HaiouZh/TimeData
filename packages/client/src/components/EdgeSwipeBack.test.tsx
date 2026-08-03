// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";

const getPlatformMock = vi.hoisted(() => vi.fn(() => "ios"));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: getPlatformMock } }));

import EdgeSwipeBack from "./EdgeSwipeBack.tsx";

function mountLayers(): { active: HTMLElement; kept: HTMLElement; overlay: HTMLElement } {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div data-kept-layer="kept"></div>
    <div data-kept-layer="active"></div>
    <div data-kept-overlay></div>`;
  document.body.appendChild(wrap);
  return {
    kept: wrap.querySelector('[data-kept-layer="kept"]') as HTMLElement,
    active: wrap.querySelector('[data-kept-layer="active"]') as HTMLElement,
    overlay: wrap.querySelector("[data-kept-overlay]") as HTMLElement,
  };
}

/**
 * jsdom 没有 TouchEvent 构造器（jsdom 29 仍未实现），故用 Event 手挂 touches / changedTouches——
 * 生产代码只读这两个字段与 target，读到的形状与真机一致。
 */
function touch(type: string, x: number, y: number, target: EventTarget = document.body) {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    touches: unknown[];
    changedTouches: unknown[];
  };
  const point = { clientX: x, clientY: y };
  ev.touches = type === "touchend" ? [] : [point];
  ev.changedTouches = [point];
  target.dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  document.body.innerHTML = "";
  getPlatformMock.mockReset();
  getPlatformMock.mockReturnValue("ios");
});

describe("EdgeSwipeBack 启动条件", () => {
  it("子页 + 边缘起手 + 有保留层 → 跟手位移写到 active 层", async () => {
    const layers = mountLayers();
    const { root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo", "/settings/data"], initialIndex: 1 },
        createElement(EdgeSwipeBack),
      ),
    );
    touch("touchstart", 5, 300);
    touch("touchmove", 90, 305);
    expect(layers.active.style.transform).toContain("translateX(");
    await unmount(root);
  });

  it("tab 主页不启动", async () => {
    const layers = mountLayers();
    const { root } = await renderDom(
      createElement(MemoryRouter, { initialEntries: ["/todo"] }, createElement(EdgeSwipeBack)),
    );
    touch("touchstart", 5, 300);
    touch("touchmove", 90, 305);
    expect(layers.active.style.transform).toBe("");
    await unmount(root);
  });

  it("目标详情页不启动", async () => {
    const layers = mountLayers();
    const { root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/goals", "/goals/g1"], initialIndex: 1 },
        createElement(EdgeSwipeBack),
      ),
    );
    touch("touchstart", 5, 300);
    touch("touchmove", 90, 305);
    expect(layers.active.style.transform).toBe("");
    await unmount(root);
  });

  it("有模态浮层时不启动", async () => {
    const layers = mountLayers();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    const { root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo", "/settings/data"], initialIndex: 1 },
        createElement(EdgeSwipeBack),
      ),
    );
    touch("touchstart", 5, 300);
    touch("touchmove", 90, 305);
    expect(layers.active.style.transform).toBe("");
    await unmount(root);
  });

  it("没有保留层时不启动", async () => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div data-kept-layer="active"></div><div data-kept-overlay></div>`;
    document.body.appendChild(wrap);
    const active = wrap.querySelector('[data-kept-layer="active"]') as HTMLElement;
    const { root } = await renderDom(
      createElement(MemoryRouter, { initialEntries: ["/settings/data"] }, createElement(EdgeSwipeBack)),
    );
    touch("touchstart", 5, 300);
    touch("touchmove", 90, 305);
    expect(active.style.transform).toBe("");
    await unmount(root);
  });

  // plan 之外补的两条。plan 的六条里没有一条走到「边缘判定」与「让路标记」，实测：把
  // onTouchStart 的 `point.clientX > EDGE_WIDTH_PX` 放宽到 2000px，六条全绿。
  it("非边缘起手不启动", async () => {
    const layers = mountLayers();
    const { root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo", "/settings/data"], initialIndex: 1 },
        createElement(EdgeSwipeBack),
      ),
    );
    // 页面正中横滑：路由、保留层、浮层全部满足，唯独起点不在左边缘。
    touch("touchstart", 200, 300);
    touch("touchmove", 285, 305);
    expect(layers.active.style.transform).toBe("");
    await unmount(root);
  });

  it("拖柄（data-edge-swipe-block）上起手不启动", async () => {
    const layers = mountLayers();
    // 真实形态：TaskRow 的拖柄按钮压在行左 2/5，正好盖住边缘起手区。
    const handle = document.createElement("button");
    handle.setAttribute("data-edge-swipe-block", "");
    const inner = document.createElement("span");
    handle.appendChild(inner);
    document.body.appendChild(handle);
    const { root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo", "/settings/data"], initialIndex: 1 },
        createElement(EdgeSwipeBack),
      ),
    );
    // 标记在祖先上也要认（沿链路上溯），故从子节点起手。
    touch("touchstart", 5, 300, inner);
    touch("touchmove", 90, 305, inner);
    expect(layers.active.style.transform).toBe("");
    await unmount(root);
  });

  it("非 iOS 平台不启动", async () => {
    getPlatformMock.mockReturnValue("android");
    const layers = mountLayers();
    const { root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo", "/settings/data"], initialIndex: 1 },
        createElement(EdgeSwipeBack),
      ),
    );
    touch("touchstart", 5, 300);
    touch("touchmove", 90, 305);
    expect(layers.active.style.transform).toBe("");
    await unmount(root);
  });
});
