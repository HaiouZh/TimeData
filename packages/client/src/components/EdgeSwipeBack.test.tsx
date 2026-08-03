// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import {
  createMemoryRouter,
  MemoryRouter,
  NavigationType,
  useBlocker,
  useLocation,
  useNavigate,
  useNavigationType,
} from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../test/domHarness.js";

const getPlatformMock = vi.hoisted(() => vi.fn(() => "ios"));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: getPlatformMock, isNativePlatform: () => true } }));

/**
 * 收尾段用**真的** KeptRouteStack：整套清理的正确与否完全取决于「返回成功后保留层从 DOM 消失」
 * 这个真实生命周期——用静态假三层跑，`resetLayers` 退化成查 DOM 也照样绿，闸就是假的。
 * 页面内容与底栏换成桩：本文件验的是手势，不是页面。
 */
const mountCounts: Record<string, number> = {};
vi.mock("./app-shell/AppRoutes.tsx", () => ({
  AppRoutes: ({ location }: { location?: { pathname: string } }) => {
    const path = location?.pathname ?? "/";
    // 计数写在 useState 初始化器里：只在**挂载**那一次跑。navigate(-1) 复用保留层则恒为 1，
    // 换成 navigate(路径) 会让 React 当作新页重挂而涨到 2。
    const [mountedPath] = useState(() => {
      mountCounts[path] = (mountCounts[path] ?? 0) + 1;
      return path;
    });
    return createElement("div", { "data-page": path, "data-mounted-path": mountedPath });
  },
}));
vi.mock("./app-shell/MobileBottomNav.tsx", () => ({
  MobileBottomNav: () => createElement("nav", { "data-bottom-nav": "" }),
}));

import { KeptRouteStack } from "./app-shell/KeptRouteStack.tsx";
import EdgeSwipeBack from "./EdgeSwipeBack.tsx";

// ---------------------------------------------------------------------------
// rAF 手工驱动。收尾全靠 rAF 逐帧插值，jsdom 里没人替我们推帧；
// 且禁真实定时等待，所以时间戳一律显式喂。
// ---------------------------------------------------------------------------
type Frame = (now: number) => void;
let frames = new Map<number, Frame>();
let nextFrameId = 1;
let clock = 0;

function installRaf(): void {
  frames = new Map();
  nextFrameId = 1;
  clock = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: Frame) => {
    const id = nextFrameId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
}

/** 把排队的帧逐轮跑掉，每轮时间戳 +1000ms（远超任何一段收尾动画，也一定跨过导航兜底窗口）。 */
async function pumpFrames(rounds = 8): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    if (frames.size === 0) return;
    const pending = [...frames.values()];
    frames.clear();
    clock += 1000;
    const now = clock;
    // 导航发生在帧回调里 → 必须包 act，React 才会在这一轮就把新 location 提交出去。
    await act(async () => {
      for (const cb of pending) cb(now);
    });
  }
}

/**
 * jsdom 没有 TouchEvent 构造器（jsdom 29 仍未实现），故用 Event 手挂 touches / changedTouches——
 * 生产代码只读这两个字段与 target，读到的形状与真机一致。
 */
function touch(
  type: string,
  x: number,
  y: number,
  options: { target?: EventTarget; t?: number; extraTouches?: number } = {},
): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    touches: unknown[];
    changedTouches: unknown[];
  };
  const point = { clientX: x, clientY: y };
  const extra = Array.from({ length: options.extraTouches ?? 0 }, () => ({ clientX: x + 60, clientY: y + 60 }));
  ev.touches = type === "touchend" || type === "touchcancel" ? [] : [point, ...extra];
  ev.changedTouches = [point];
  // timeStamp 是只读属性，但速度判定要吃确定的时间差：相邻两条合成事件的真实间隔常不到 0.1ms，
  // 算出的速度会远超甩动阈值，「位移不够所以取消」那一档用例就成了恒绿的假闸。
  if (options.t !== undefined) Object.defineProperty(ev, "timeStamp", { value: options.t });
  (options.target ?? document.body).dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  document.body.innerHTML = "";
  getPlatformMock.mockReset();
  getPlatformMock.mockReturnValue("ios");
  for (const key of Object.keys(mountCounts)) delete mountCounts[key];
  installRaf();
});

// ===========================================================================
// 一、起手条件——静态三层即可，不需要真栈
// ===========================================================================

function mountLayers(): { active: HTMLElement; kept: HTMLElement; overlay: HTMLElement } {
  const wrap = document.createElement("div");
  // 与 KeptRouteStack 同构：遮罩在**保留层内部**。
  wrap.innerHTML = `
    <div data-kept-layer="kept"><div data-kept-overlay></div></div>
    <div data-kept-layer="active"></div>`;
  document.body.appendChild(wrap);
  return {
    kept: wrap.querySelector('[data-kept-layer="kept"]') as HTMLElement,
    active: wrap.querySelector('[data-kept-layer="active"]') as HTMLElement,
    overlay: wrap.querySelector("[data-kept-overlay]") as HTMLElement,
  };
}

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
    wrap.innerHTML = `<div data-kept-layer="active"></div>`;
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
    // 真实形态：设置子页 SortableCategoryItem 的拖柄按钮左沿约 17px，压住边缘起手区。
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
    touch("touchstart", 5, 300, { target: inner });
    touch("touchmove", 90, 305, { target: inner });
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

  it("位移没过 slop 时既不接管也不拦事件", async () => {
    const layers = mountLayers();
    const { root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo", "/settings/data"], initialIndex: 1 },
        createElement(EdgeSwipeBack),
      ),
    );
    touch("touchstart", 5, 300);
    // 拇指贴左边缘刚开始往下滑列表时的真实形状：水平「主导」但位移只有几像素。
    const moved = touch("touchmove", 8, 301);
    expect(layers.active.style.transform).toBe("");
    expect(moved.defaultPrevented).toBe(false);
    await unmount(root);
  });

  it("过 slop 后判成纵向 → 整笔作废，之后拐成横向也不接管", async () => {
    const layers = mountLayers();
    const { root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo", "/settings/data"], initialIndex: 1 },
        createElement(EdgeSwipeBack),
      ),
    );
    touch("touchstart", 5, 300);
    const vertical = touch("touchmove", 9, 340);
    expect(layers.active.style.transform).toBe("");
    expect(vertical.defaultPrevented).toBe(false);
    // 同一笔手势里改成横向：方向只判一次，这里必须继续放行，否则滚到一半会被抢走。
    const horizontal = touch("touchmove", 150, 340);
    expect(layers.active.style.transform).toBe("");
    expect(horizontal.defaultPrevented).toBe(false);
    await unmount(root);
  });
});

// ===========================================================================
// 二、收尾——真 KeptRouteStack + 真 data router
// ===========================================================================

const seen = { pathname: "", navType: "" as string };

function Probe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  seen.pathname = location.pathname;
  seen.navType = navigationType;
  return null;
}

function GoButton() {
  const navigate = useNavigate();
  return createElement(
    "button",
    { type: "button", "data-testid": "go", onClick: () => navigate("/settings/data") },
    "去子页",
  );
}

/** 模拟「未保存就别走」守卫：拦住离开指定页面的一切导航，且永不 proceed（用户还在看确认框）。 */
function Blocker({ from }: { from: string }) {
  useBlocker(
    ({ currentLocation, nextLocation }) => currentLocation.pathname === from && nextLocation.pathname !== from,
  );
  return null;
}

function Shell({ blockFrom }: { blockFrom?: string }) {
  return createElement(
    "div",
    null,
    createElement(EdgeSwipeBack),
    createElement(KeptRouteStack),
    createElement(Probe),
    createElement(GoButton),
    blockFrom ? createElement(Blocker, { from: blockFrom }) : null,
  );
}

/** 从 tab 主页推进到设置子页——只有这样栈里才真的有两层（初始 POP 会被 nextStack 重置成一层）。 */
async function mountAtSubPage(blockFrom?: string) {
  const router = createMemoryRouter([{ path: "*", element: createElement(Shell, { blockFrom }) }], {
    initialEntries: ["/todo"],
  });
  const rendered = await renderDom(createElement(RouterProvider, { router }));
  await click(rendered.host.querySelector('[data-testid="go"]'));
  expect(document.querySelectorAll("[data-kept-layer]")).toHaveLength(2);
  return rendered;
}

function layerRefs() {
  return {
    active: document.querySelector('[data-kept-layer="active"]') as HTMLElement,
    kept: document.querySelector('[data-kept-layer="kept"]') as HTMLElement,
    overlay: document.querySelector("[data-kept-overlay]") as HTMLElement,
  };
}

/** jsdom 不做布局，getBoundingClientRect 恒 0，不钉死层宽就会退回 window.innerWidth。 */
function setLayerWidth(el: HTMLElement, width: number): void {
  el.getBoundingClientRect = () =>
    ({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

/** 一整笔手势：边缘落点 → 过 slop → 拖到 dx → 收尾。时间戳拉得足够开，速度恒低于甩动阈值。 */
function swipe(dx: number, endType: "touchend" | "touchcancel" = "touchend"): void {
  const mid = Math.min(20, dx);
  touch("touchstart", 5, 300, { t: 0 });
  touch("touchmove", 5 + mid, 302, { t: 400 });
  touch("touchmove", 5 + dx, 302, { t: 2000 });
  touch(endType, 5 + dx, 302, { t: 2000 });
}

function expectLayersReset(active: HTMLElement, kept: HTMLElement, overlay: HTMLElement): void {
  expect(active.style.transform).toBe("");
  expect(active.style.willChange).toBe("");
  expect(kept.style.transform).toBe("");
  expect(kept.style.willChange).toBe("");
  expect(kept.style.visibility).toBe("hidden");
  expect(overlay.style.opacity).toBe("0");
}

describe("EdgeSwipeBack 收尾", () => {
  it("拖过阈值松手 → 走 navigate(-1) 回到来处，保留层被复用而非重挂", async () => {
    const { root } = await mountAtSubPage();
    const { active } = layerRefs();
    setLayerWidth(active, 400); // 完成阈值 = 133px

    swipe(300);
    await pumpFrames();

    expect(seen.pathname).toBe("/todo");
    // POP 才是 navigate(-1)。改成 navigate("/todo") 是 PUSH、加 {replace:true} 是 REPLACE，
    // 两者都会生成新 location.key，保留层被当新页重挂——整批「上一页不卸载」的收益归零。
    expect(seen.navType).toBe(NavigationType.Pop);
    expect(document.querySelectorAll("[data-kept-layer]")).toHaveLength(1);
    expect(mountCounts["/todo"]).toBe(1);
    await unmount(root);
  });

  it("成功返回后幸存层不带残留 transform / will-change，且仍然可见", async () => {
    const { root } = await mountAtSubPage();
    setLayerWidth(layerRefs().active, 400);

    swipe(300);
    await pumpFrames();

    // 栈已截断成一层：任何「收尾时重新查三层」的清理写法在这条路径上都查不到东西，
    // transform 与 will-change 会永久留下——而非 none 的 transform 会让该层成为
    // position:fixed 后代的包含块，整屏浮层从此盖不住状态栏。
    const survivor = document.querySelector('[data-kept-layer="active"]') as HTMLElement;
    expect(survivor.style.transform).toBe("");
    expect(survivor.style.willChange).toBe("");
    expect(survivor.style.visibility).toBe("visible");
    await unmount(root);
  });

  it("位移不够松手 → 不导航，两层与遮罩全部复位", async () => {
    const { root } = await mountAtSubPage();
    const { active, kept, overlay } = layerRefs();
    setLayerWidth(active, 400);

    swipe(100); // < 133px 阈值，且速度远低于甩动档
    await pumpFrames();

    expect(seen.pathname).toBe("/settings/data");
    expect(document.querySelectorAll("[data-kept-layer]")).toHaveLength(2);
    expectLayersReset(active, kept, overlay);
    await unmount(root);
  });

  it("拉回起点再松手也要复位——首末位移相同不该让收尾整个不跑", async () => {
    const { root } = await mountAtSubPage();
    const { active, kept, overlay } = layerRefs();
    setLayerWidth(active, 400);

    touch("touchstart", 5, 300, { t: 0 });
    touch("touchmove", 105, 302, { t: 400 });
    touch("touchmove", 5, 302, { t: 2000 }); // 拉回原点：active 又回到 translateX(0px)
    touch("touchend", 5, 302, { t: 2000 });
    await pumpFrames();

    expect(seen.pathname).toBe("/settings/data");
    expectLayersReset(active, kept, overlay);
    await unmount(root);
  });

  it("系统打断（touchcancel）恒按取消收尾，绝不返回", async () => {
    const { root } = await mountAtSubPage();
    const { active, kept, overlay } = layerRefs();
    setLayerWidth(active, 400);

    // 位移已经过阈值——正常抬手会返回，被打断则必须留在原地：用户根本没松手。
    swipe(300, "touchcancel");
    await pumpFrames();

    expect(seen.pathname).toBe("/settings/data");
    expect(document.querySelectorAll("[data-kept-layer]")).toHaveLength(2);
    expectLayersReset(active, kept, overlay);
    await unmount(root);
  });

  it("第二根手指落下 → 当场收尾复位，不把两层冻在半途", async () => {
    const { root } = await mountAtSubPage();
    const { active, kept, overlay } = layerRefs();
    setLayerWidth(active, 400);

    touch("touchstart", 5, 300, { t: 0 });
    touch("touchmove", 105, 302, { t: 400 });
    expect(active.style.transform).toBe("translateX(100px)");
    touch("touchstart", 200, 500, { t: 500, extraTouches: 1 });
    await pumpFrames();

    expect(seen.pathname).toBe("/settings/data");
    expectLayersReset(active, kept, overlay);
    await unmount(root);
  });

  it("完成阈值按层自身宽度算，不按窗口宽（iPad 上层比窗口窄）", async () => {
    const { root } = await mountAtSubPage();
    const { active } = layerRefs();
    const layerWidth = 600;
    setLayerWidth(active, layerWidth);
    const dx = Math.round(layerWidth / 3) + 50; // 250：按层宽算够，按窗口宽算不够
    // 这条断言防用例变成假闸：窗口不够宽的话两个阈值分不开，用例就白设了。
    expect(dx).toBeLessThan(window.innerWidth / 3);

    swipe(dx);
    await pumpFrames();

    expect(seen.pathname).toBe("/todo");
    await unmount(root);
  });

  it("被守卫拦下 → 立刻弹回原位，不让用户对着不吃点击的屏幕干等", async () => {
    const { root } = await mountAtSubPage("/settings/data");
    const { active, kept, overlay } = layerRefs();
    setLayerWidth(active, 400);

    swipe(300);
    await pumpFrames();

    expect(seen.pathname).toBe("/settings/data");
    expect(document.querySelectorAll("[data-kept-layer]")).toHaveLength(2);
    expectLayersReset(active, kept, overlay);
    await unmount(root);
  });

  it("取消一次之后紧接着再滑一次，仍能正常返回（不留跨手势残状态）", async () => {
    const { root } = await mountAtSubPage();
    setLayerWidth(layerRefs().active, 400);

    swipe(100);
    await pumpFrames();
    expect(seen.pathname).toBe("/settings/data");

    setLayerWidth(layerRefs().active, 400);
    swipe(300);
    await pumpFrames();

    expect(seen.pathname).toBe("/todo");
    expect(seen.navType).toBe(NavigationType.Pop);
    await unmount(root);
  });
});
