// @vitest-environment jsdom
import { DndContext } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { TodoDragDock } from "./TodoDragDock.js";

const projects = [
  { goalId: "g1", goalTitle: "装修房子" },
  { goalId: "g2", goalTitle: "学吉他" },
];

function dock(host: HTMLElement): HTMLElement {
  const el = host.querySelector('[data-testid="todo-drag-dock"]');
  if (!el) throw new Error("dock 未渲染");
  return el as HTMLElement;
}

function pillIds(host: HTMLElement): string[] {
  return [...host.querySelectorAll('[data-testid="todo-dock-pill"]')].map(
    (el) => el.getAttribute("data-dock-id") ?? "",
  );
}

describe("TodoDragDock", () => {
  it("拖 inbox 行:按序渲染 今天/手头/项目 药丸,无收件箱", async () => {
    const { host, root } = await renderDom(
      <DndContext>
        <TodoDragDock dragging dockEngaged activeContainerId="pool:inbox" projects={projects} dropBlocked={false} />
      </DndContext>,
    );
    expect(pillIds(host)).toEqual(["dock:pool:today", "dock:hand", "dock:project:g1", "dock:project:g2"]);
    expect(dock(host).textContent).toContain("装修房子");
    await unmount(root);
  });

  it("dragging=false 时 aria-hidden 且透明(常驻挂载只切透明度)", async () => {
    const { host, root } = await renderDom(
      <DndContext>
        <TodoDragDock dragging={false} dockEngaged={false} activeContainerId={null} projects={projects} dropBlocked={null} />
      </DndContext>,
    );
    expect(dock(host).getAttribute("aria-hidden")).toBe("true");
    await unmount(root);
  });

  it("dropBlocked:项目药丸 data-drop-blocked=true,池/手头药丸不受影响", async () => {
    const { host, root } = await renderDom(
      <DndContext>
        <TodoDragDock dragging dockEngaged activeContainerId="pool:today" projects={projects} dropBlocked={true} />
      </DndContext>,
    );
    const byId = (id: string) => host.querySelector(`[data-dock-id="${id}"]`);
    expect(byId("dock:project:g1")?.getAttribute("data-drop-blocked")).toBe("true");
    expect(byId("dock:hand")?.getAttribute("data-drop-blocked")).toBe("false");
    expect(byId("dock:pool:inbox")?.getAttribute("data-drop-blocked")).toBe("false");
    await unmount(root);
  });
});

describe("TodoDragDock 三形态", () => {
  it("aria-hidden 只在 engaged 态放开:hint 的药丸不可见也投不中,不该报给读屏", async () => {
    // 把判据写成 `state === "hidden"` 会让 hint 态的四个药丸被读屏当可用落点报出来，
    // 而此刻它们既隐身又不接投递。原用例只覆盖 dragging=false，这个变异全绿。
    const hint = await renderDom(
      <DndContext>
        <TodoDragDock dragging dockEngaged={false} activeContainerId="pool:inbox" projects={projects} dropBlocked={false} />
      </DndContext>,
    );
    expect(dock(hint.host).getAttribute("aria-hidden")).toBe("true");
    await unmount(hint.root);

    const engaged = await renderDom(
      <DndContext>
        <TodoDragDock dragging dockEngaged activeContainerId="pool:inbox" projects={projects} dropBlocked={false} />
      </DndContext>,
    );
    expect(dock(engaged.host).getAttribute("aria-hidden")).toBe("false");
    await unmount(engaged.root);
  });

  it("拖拽中未进 dock 档:hint 细条形态,药丸不接投递(命中由碰撞层按车道剔除)", async () => {
    const { host, root } = await renderDom(
      <DndContext>
        <TodoDragDock dragging dockEngaged={false} activeContainerId="pool:inbox" projects={projects} dropBlocked={false} />
      </DndContext>,
    );
    expect(dock(host).getAttribute("data-dock-state")).toBe("hint");
    for (const el of host.querySelectorAll('[data-testid="todo-dock-pill"]')) {
      expect(el.getAttribute("data-dock-engaged")).toBe("false");
    }
    await unmount(root);
  });

  it("进 dock 档:engaged 完整坞,药丸标记为可投", async () => {
    const { host, root } = await renderDom(
      <DndContext>
        <TodoDragDock dragging dockEngaged activeContainerId="pool:inbox" projects={projects} dropBlocked={false} />
      </DndContext>,
    );
    expect(dock(host).getAttribute("data-dock-state")).toBe("engaged");
    for (const el of host.querySelectorAll('[data-testid="todo-dock-pill"]')) {
      expect(el.getAttribute("data-dock-engaged")).toBe("true");
    }
    await unmount(root);
  });

  it("手头源拖拽中:空坞连细条都不出(hidden)", async () => {
    const { host, root } = await renderDom(
      <DndContext>
        <TodoDragDock dragging dockEngaged={false} activeContainerId="hand" projects={projects} dropBlocked={false} />
      </DndContext>,
    );
    expect(dock(host).getAttribute("data-dock-state")).toBe("hidden");
    expect(pillIds(host)).toEqual([]);
    await unmount(root);
  });

  it("未拖拽:hidden(常驻挂载只切透明度不变)", async () => {
    const { host, root } = await renderDom(
      <DndContext>
        <TodoDragDock dragging={false} dockEngaged={false} activeContainerId={null} projects={projects} dropBlocked={null} />
      </DndContext>,
    );
    expect(dock(host).getAttribute("data-dock-state")).toBe("hidden");
    await unmount(root);
  });
});
