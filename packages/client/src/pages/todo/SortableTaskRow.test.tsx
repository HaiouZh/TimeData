// @vitest-environment jsdom
import { DndContext, KeyboardSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { SortableTaskRow } from "./SortableTaskRow.js";

/**
 * 最小 DndContext + SortableContext 容器：两行，row-a 挂拖柄，row-b 不挂。
 * jsdom 里所有元素的 getBoundingClientRect 恒为全零矩形，dnd-kit 量不出真实高度/位置，
 * `verticalListSortingStrategy` 算出的 activeNodeRect 恒 falsy → transform 恒 null，
 * 这会让 freezeShift 的断言变成假闸（不冻结也测不出非空 transform，两种状态测出来一个样）。
 * 这里显式 mock 两行的 rect（各高 40px、纵向相邻），让 dnd-kit 真的量得到、真的算出非零位移——
 * 这是本文件唯一的非标准之处，专为让 freezeShift 的断言有真实差异可测。
 */
function mockRowRects(host: HTMLElement): () => void {
  const original = Element.prototype.getBoundingClientRect;
  const rowEls = Array.from(host.children) as HTMLElement[];
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const index = rowEls.indexOf(this as HTMLElement);
    if (index === -1) return original.call(this);
    const top = index * 40;
    return {
      top,
      bottom: top + 40,
      left: 0,
      right: 300,
      width: 300,
      height: 40,
      x: 0,
      y: top,
      toJSON() {
        return this;
      },
    } as DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

function Harness({ freezeShift }: { freezeShift: boolean }) {
  const sensors = useSensors(useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  return (
    <DndContext sensors={sensors}>
      <SortableContext items={["row-a", "row-b"]} strategy={verticalListSortingStrategy}>
        <SortableTaskRow id="row-a" containerId="pool:today" freezeShift={freezeShift}>
          {(handle) => (
            <button
              type="button"
              aria-label="drag-a"
              ref={handle.setActivatorNodeRef}
              {...handle.attributes}
              {...handle.listeners}
            >
              A
            </button>
          )}
        </SortableTaskRow>
        <SortableTaskRow id="row-b" containerId="pool:today" freezeShift={freezeShift}>
          {() => <div data-testid="row-b-body">B</div>}
        </SortableTaskRow>
      </SortableContext>
    </DndContext>
  );
}

/** SortableTaskRow 的外层 div（挂 style.transform 的那层）：row-b 内容节点的父元素。 */
function rowBWrapper(host: HTMLElement): HTMLElement {
  return (host.querySelector('[data-testid="row-b-body"]') as HTMLElement).parentElement as HTMLElement;
}

/** 键盘拾起 row-a 再按一次向下方向键：让 dnd-kit 真的把 over 挪到 row-b、触发 row-b 的避让计算。 */
async function pickUpAndMoveDown(handle: HTMLElement): Promise<void> {
  await act(async () => {
    handle.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }));
  });
  await act(async () => {
    handle.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowDown", bubbles: true, cancelable: true }));
  });
}

describe("SortableTaskRow · freezeShift", () => {
  it("freezeShift=false（默认）：同容器拖拽让位时，非拖拽行拿到 dnd-kit 算出的避让 transform", async () => {
    const { host, root } = await renderDom(<Harness freezeShift={false} />);
    const restore = mockRowRects(host);
    await pickUpAndMoveDown(host.querySelector('[aria-label="drag-a"]') as HTMLElement);
    // 承重前提：证明这套 harness 真的能让 dnd-kit 给非拖拽行算出非空 transform（不是恒 null）。
    // 若这一断言本身就红，说明 harness 造不出真实差异，不能继续信任下面 freezeShift=true 的断言。
    expect(rowBWrapper(host).style.transform).toBe("translate3d(0px, -40px, 0) scaleX(1) scaleY(1)");
    restore();
    await unmount(root);
  });

  it("freezeShift=true 且非拖拽态：同样的让位场景下 style.transform 应为空（不再避让，只留高亮环）", async () => {
    const { host, root } = await renderDom(<Harness freezeShift={true} />);
    const restore = mockRowRects(host);
    await pickUpAndMoveDown(host.querySelector('[aria-label="drag-a"]') as HTMLElement);
    expect(rowBWrapper(host).style.transform).toBe("");
    restore();
    await unmount(root);
  });

  it("freezeShift=true 但正在被拖的那一行本身：transform 不冻结，否则拖不动", async () => {
    const { host, root } = await renderDom(<Harness freezeShift={true} />);
    const restore = mockRowRects(host);
    const handle = host.querySelector('[aria-label="drag-a"]') as HTMLElement;
    await pickUpAndMoveDown(handle);
    // row-a 是被拖行本身：isDragging=true，freezeShift 不冻结它——它得跟着键盘位移走。
    const rowAWrapper = handle.parentElement as HTMLElement;
    expect(rowAWrapper.style.transform).toBe("translate3d(0px, 40px, 0) scaleX(1) scaleY(1)");
    restore();
    await unmount(root);
  });
});
