// @vitest-environment jsdom
import { Sun, Trash, Tray } from "@phosphor-icons/react";
import { act, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { click, type Root, renderDom } from "../../test/domHarness.js";
import { ROW_SWIPE_ACTION_WIDTH_PX, ROW_SWIPE_LONG_PRESS_MS } from "./rowSwipe.js";
import { SwipeActionRow, type SwipeRowAction } from "./SwipeActionRow.js";

/**
 * jsdom 没有 TouchEvent 构造器，用 Event 手挂 touches / changedTouches（与 EdgeSwipeBack.test 同法）。
 * timeStamp 必须显式给：合成事件的真实间隔不到 0.1ms，算出的速度恒超甩动阈值，
 * 「慢速松手按位置判」的用例会变成恒绿假闸。
 */
function touch(target: EventTarget, type: string, x: number, y: number, t: number): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    touches: unknown[];
    changedTouches: unknown[];
  };
  const point = { clientX: x, clientY: y };
  ev.touches = type === "touchend" || type === "touchcancel" ? [] : [point];
  ev.changedTouches = [point];
  Object.defineProperty(ev, "timeStamp", { value: t });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

/** 按顺序喂一笔手势：points 是 [x, y, t]，首点 touchstart、中间 touchmove、最后 touchend（t 用末点）。 */
function gesture(target: EventTarget, points: Array<[number, number, number]>, endT?: number): Event[] {
  const events: Event[] = [];
  points.forEach(([x, y, t], index) => {
    events.push(touch(target, index === 0 ? "touchstart" : "touchmove", x, y, t));
  });
  const last = points[points.length - 1];
  if (last) events.push(touch(target, "touchend", last[0], last[1], endT ?? last[2]));
  return events;
}

function translateOf(el: HTMLElement): number {
  const match = /translateX\((-?[\d.]+)px\)/.exec(el.style.transform);
  return match ? Number(match[1]) : 0;
}

function parts(host: HTMLElement) {
  const row = host.querySelector<HTMLElement>("[data-swipe-row]");
  const content = host.querySelector<HTMLElement>("[data-swipe-content]");
  if (!row || !content) throw new Error("swipe row not rendered");
  return {
    row,
    content,
    trailing: host.querySelector<HTMLElement>('[data-swipe-actions="trailing"]'),
    leading: host.querySelector<HTMLElement>('[data-swipe-actions="leading"]'),
  };
}

function actions(overrides: { toInbox?: () => void; remove?: () => void; toToday?: () => void } = {}) {
  const trailing: SwipeRowAction[] = [
    { key: "inbox", label: "回收件箱 示例", icon: Tray, tone: "neutral", onTrigger: overrides.toInbox ?? vi.fn() },
    { key: "delete", label: "删除 示例", icon: Trash, tone: "danger", onTrigger: overrides.remove ?? vi.fn() },
  ];
  const leading: SwipeRowAction[] = [
    { key: "today", label: "排进今天 示例", icon: Sun, tone: "accent", onTrigger: overrides.toToday ?? vi.fn() },
  ];
  return { trailing, leading };
}

const TRAILING_WIDTH = ROW_SWIPE_ACTION_WIDTH_PX * 2;

function row(props: Partial<Parameters<typeof SwipeActionRow>[0]> = {}, onRowClick = vi.fn()): ReactElement {
  const { trailing } = actions();
  return (
    <SwipeActionRow enabled trailing={trailing} leading={[]} {...props}>
      <button type="button" data-testid="row-body" onClick={onRowClick}>
        示例
      </button>
    </SwipeActionRow>
  );
}

async function rerender(root: Root, node: ReactElement) {
  await act(async () => root.render(node));
}

/** 慢速左滑到 -100px 后停住松手：位置过半、速度作废，停在打开态。 */
function openTrailing(target: EventTarget) {
  gesture(
    target,
    [
      [300, 20, 0],
      [285, 20, 16],
      [240, 20, 32],
      [200, 20, 48],
    ],
    400,
  );
}

describe("SwipeActionRow", () => {
  it("未启用（桌面细指针 / 多选态）：不渲染动作按钮，横滑不接管", async () => {
    const { host } = await renderDom(row({ enabled: false }));
    const { content } = parts(host);
    expect(host.querySelector('[aria-label="删除 示例"]')).toBeNull();

    const events = gesture(content, [
      [300, 20, 0],
      [250, 20, 16],
    ]);
    expect(events[1]?.defaultPrevented).toBe(false);
    expect(translateOf(content)).toBe(0);
  });

  it("慢速左滑过半后停住松手：停在打开态，动作条露出全宽、按钮等宽", async () => {
    const { host } = await renderDom(row());
    const { row: rowEl, content, trailing } = parts(host);
    const body = host.querySelector('[data-testid="row-body"]') as HTMLElement;

    openTrailing(body);

    expect(rowEl.getAttribute("data-swipe-open")).toBe("trailing");
    expect(translateOf(content)).toBe(-TRAILING_WIDTH);
    expect(trailing?.style.width).toBe(`${TRAILING_WIDTH}px`);
  });

  it("接管后的 touchmove 拦下默认行为（不让列表同时滚动）", async () => {
    const { host } = await renderDom(row());
    const body = host.querySelector('[data-testid="row-body"]') as HTMLElement;
    const events = gesture(body, [
      [300, 20, 0],
      [280, 21, 16],
      [250, 22, 32],
    ]);
    expect(events[1]?.defaultPrevented).toBe(true);
    expect(events[2]?.defaultPrevented).toBe(true);
  });

  it("露出不到一半、慢速松手：收回", async () => {
    const { host } = await renderDom(row());
    const { row: rowEl, content } = parts(host);
    const body = host.querySelector('[data-testid="row-body"]') as HTMLElement;

    gesture(
      body,
      [
        [300, 20, 0],
        [285, 20, 16],
        [260, 20, 32],
      ],
      400,
    );

    expect(rowEl.hasAttribute("data-swipe-open")).toBe(false);
    expect(translateOf(content)).toBe(0);
  });

  it("露得少但甩得快：照样打开", async () => {
    const { host } = await renderDom(row());
    const { row: rowEl } = parts(host);
    const body = host.querySelector('[data-testid="row-body"]') as HTMLElement;

    gesture(body, [
      [300, 20, 0],
      [285, 20, 10],
      [270, 20, 20],
    ]);

    expect(rowEl.getAttribute("data-swipe-open")).toBe("trailing");
  });

  it("竖向滑动不接管：不拦默认行为、行不动", async () => {
    const { host } = await renderDom(row());
    const { content } = parts(host);
    const body = host.querySelector('[data-testid="row-body"]') as HTMLElement;

    const events = gesture(body, [
      [300, 20, 0],
      [298, 40, 16],
      [240, 80, 32],
    ]);

    expect(events.some((e) => e.defaultPrevented)).toBe(false);
    expect(translateOf(content)).toBe(0);
  });

  it("按住过长按线再横移（拖拽排序起手）：不接管", async () => {
    const { host } = await renderDom(row());
    const { content } = parts(host);
    const body = host.querySelector('[data-testid="row-body"]') as HTMLElement;

    const events = gesture(body, [
      [300, 20, 0],
      [240, 20, ROW_SWIPE_LONG_PRESS_MS + 20],
    ]);

    expect(events[1]?.defaultPrevented).toBe(false);
    expect(translateOf(content)).toBe(0);
  });

  it("朝没有动作的一侧滑：不接管、行不动", async () => {
    const { host } = await renderDom(row());
    const { content, leading } = parts(host);
    const body = host.querySelector('[data-testid="row-body"]') as HTMLElement;
    expect(leading).toBeNull();

    const events = gesture(body, [
      [100, 20, 0],
      [160, 20, 16],
    ]);

    expect(events[1]?.defaultPrevented).toBe(false);
    expect(translateOf(content)).toBe(0);
  });

  it("右滑打开左侧动作", async () => {
    const { leading } = actions();
    const { host } = await renderDom(row({ leading }));
    const { row: rowEl, content } = parts(host);
    const body = host.querySelector('[data-testid="row-body"]') as HTMLElement;

    gesture(
      body,
      [
        [100, 20, 0],
        [115, 20, 16],
        [150, 20, 32],
      ],
      400,
    );

    expect(rowEl.getAttribute("data-swipe-open")).toBe("leading");
    expect(translateOf(content)).toBe(ROW_SWIPE_ACTION_WIDTH_PX);
  });

  it("打开态点一下行：只收回，不触发行本身的点击", async () => {
    const onRowClick = vi.fn();
    const { host } = await renderDom(row({}, onRowClick));
    const { row: rowEl } = parts(host);
    const body = host.querySelector('[data-testid="row-body"]') as HTMLElement;
    openTrailing(body);

    gesture(body, [[150, 20, 1000]], 1050);
    await click(body);

    expect(rowEl.hasAttribute("data-swipe-open")).toBe(false);
    expect(onRowClick).not.toHaveBeenCalled();

    // 收回后的下一次点击恢复正常
    gesture(body, [[150, 20, 2000]], 2050);
    await click(body);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("点动作按钮：执行一次并收回", async () => {
    const remove = vi.fn();
    const { trailing } = actions({ remove });
    const { host } = await renderDom(row({ trailing }));
    const { row: rowEl } = parts(host);
    const body = host.querySelector('[data-testid="row-body"]') as HTMLElement;
    openTrailing(body);

    const button = host.querySelector('[aria-label="删除 示例"]') as HTMLElement;
    touch(button, "touchstart", 360, 20, 1000);
    touch(button, "touchend", 360, 20, 1050);
    await click(button);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(rowEl.hasAttribute("data-swipe-open")).toBe(false);
  });

  it("同时只开一行：碰另一行时已打开的那行收回", async () => {
    const { host } = await renderDom(
      <div>
        {row()}
        {row()}
      </div>,
    );
    const rows = host.querySelectorAll<HTMLElement>("[data-swipe-row]");
    const bodies = host.querySelectorAll<HTMLElement>('[data-testid="row-body"]');
    const [firstRow, secondRow] = [rows[0], rows[1]];
    const [firstBody, secondBody] = [bodies[0], bodies[1]];
    if (!firstRow || !secondRow || !firstBody || !secondBody) throw new Error("rows not rendered");

    openTrailing(firstBody);
    expect(firstRow.getAttribute("data-swipe-open")).toBe("trailing");

    openTrailing(secondBody);
    expect(firstRow.hasAttribute("data-swipe-open")).toBe(false);
    expect(secondRow.getAttribute("data-swipe-open")).toBe("trailing");
  });

  it("滚动列表时收回", async () => {
    const { host } = await renderDom(row());
    const { row: rowEl } = parts(host);
    const body = host.querySelector('[data-testid="row-body"]') as HTMLElement;
    openTrailing(body);

    act(() => {
      document.body.dispatchEvent(new Event("scroll"));
    });

    expect(rowEl.hasAttribute("data-swipe-open")).toBe(false);
  });

  it("打开态下动作组变了（行换了池）：收回，不停在旧宽度", async () => {
    const { host, root } = await renderDom(row());
    const { row: rowEl, content } = parts(host);
    const body = host.querySelector('[data-testid="row-body"]') as HTMLElement;
    openTrailing(body);

    const { trailing } = actions();
    await rerender(root, row({ trailing: trailing.slice(1) }));

    expect(rowEl.hasAttribute("data-swipe-open")).toBe(false);
    expect(translateOf(content)).toBe(0);
  });

  it("打开态下被禁用（进多选态）：立即复位", async () => {
    const { host, root } = await renderDom(row());
    const { row: rowEl, content } = parts(host);
    const body = host.querySelector('[data-testid="row-body"]') as HTMLElement;
    openTrailing(body);

    await rerender(root, row({ enabled: false }));

    expect(rowEl.hasAttribute("data-swipe-open")).toBe(false);
    expect(content.style.transform).toBe("");
  });

  it("收回动画结束后清掉 transform：不给行留下包含块", async () => {
    const { host } = await renderDom(row());
    const { content } = parts(host);
    const body = host.querySelector('[data-testid="row-body"]') as HTMLElement;
    openTrailing(body);
    gesture(body, [[150, 20, 1000]], 1050);

    act(() => {
      content.dispatchEvent(new Event("transitionend"));
    });

    expect(content.style.transform).toBe("");
  });
});
