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
        <TodoDragDock dragging activeContainerId="pool:inbox" projects={projects} dropBlocked={false} />
      </DndContext>,
    );
    expect(pillIds(host)).toEqual(["dock:pool:today", "dock:hand", "dock:project:g1", "dock:project:g2"]);
    expect(dock(host).textContent).toContain("装修房子");
    await unmount(root);
  });

  it("dragging=false 时 aria-hidden 且透明(常驻挂载只切透明度)", async () => {
    const { host, root } = await renderDom(
      <DndContext>
        <TodoDragDock dragging={false} activeContainerId={null} projects={projects} dropBlocked={null} />
      </DndContext>,
    );
    expect(dock(host).getAttribute("aria-hidden")).toBe("true");
    await unmount(root);
  });

  it("dropBlocked:项目药丸 data-drop-blocked=true,池/手头药丸不受影响", async () => {
    const { host, root } = await renderDom(
      <DndContext>
        <TodoDragDock dragging activeContainerId="pool:today" projects={projects} dropBlocked={true} />
      </DndContext>,
    );
    const byId = (id: string) => host.querySelector(`[data-dock-id="${id}"]`);
    expect(byId("dock:project:g1")?.getAttribute("data-drop-blocked")).toBe("true");
    expect(byId("dock:hand")?.getAttribute("data-drop-blocked")).toBe("false");
    expect(byId("dock:pool:inbox")?.getAttribute("data-drop-blocked")).toBe("false");
    await unmount(root);
  });
});
