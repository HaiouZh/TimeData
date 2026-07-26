// @vitest-environment jsdom
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { TodoSelectionBar } from "./TodoSelectionBar.js";

const base = {
  selectedCount: 3,
  projects: [
    { goalId: "g1", goalTitle: "装修" },
    { goalId: "g2", goalTitle: "搬家" },
  ],
  bottomOffsetPx: 0,
  onCreate: vi.fn(),
  onAssign: vi.fn(),
  onCancel: vi.fn(),
};

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("TodoSelectionBar", () => {
  it("显示已选条数", async () => {
    const { host, root } = await renderDom(createElement(TodoSelectionBar, { ...base, onCreate: vi.fn() }));
    expect(host.textContent).toContain("已选 3 条");
    await unmount(root);
  });

  it("名字为空时「圈成项目」不可用", async () => {
    const onCreate = vi.fn();
    const { host, root } = await renderDom(createElement(TodoSelectionBar, { ...base, onCreate }));
    const button = host.querySelector('[aria-label="圈成项目"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    await click(button);
    expect(onCreate).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("只输空白也不可用（trim 后为空）", async () => {
    const { host, root } = await renderDom(createElement(TodoSelectionBar, { ...base, onCreate: vi.fn() }));
    await typeInto(host.querySelector('[aria-label="项目名"]') as HTMLInputElement, "   ");
    expect((host.querySelector('[aria-label="圈成项目"]') as HTMLButtonElement).disabled).toBe(true);
    await unmount(root);
  });

  it("输入名字后点按钮建组，回传 trim 后的名字", async () => {
    const onCreate = vi.fn();
    const { host, root } = await renderDom(createElement(TodoSelectionBar, { ...base, onCreate }));
    await typeInto(host.querySelector('[aria-label="项目名"]') as HTMLInputElement, " 装修 ");
    await click(host.querySelector('[aria-label="圈成项目"]'));

    expect(onCreate).toHaveBeenCalledWith("装修");
    await unmount(root);
  });

  it("在输入框里回车即建组", async () => {
    const onCreate = vi.fn();
    const { host, root } = await renderDom(createElement(TodoSelectionBar, { ...base, onCreate }));
    const input = host.querySelector('[aria-label="项目名"]') as HTMLInputElement;
    await typeInto(input, "装修");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onCreate).toHaveBeenCalledWith("装修");
    await unmount(root);
  });

  it("只输空白时回车也不建组", async () => {
    // 回车是与按钮并行的第二条提交路径：按钮 disabled 只挡得住点击，挡不住键盘。
    // 少了 submitCreate 里那道 canCreate 早退，空名字回车会一路打到 createProjectWithMembers，
    // 用户只是按了个回车却吃到一句「项目名不能为空」。
    const onCreate = vi.fn();
    const { host, root } = await renderDom(createElement(TodoSelectionBar, { ...base, onCreate }));
    const input = host.querySelector('[aria-label="项目名"]') as HTMLInputElement;
    await typeInto(input, "   ");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onCreate).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("一条都没选时回车也不建组", async () => {
    const onCreate = vi.fn();
    const { host, root } = await renderDom(createElement(TodoSelectionBar, { ...base, selectedCount: 0, onCreate }));
    const input = host.querySelector('[aria-label="项目名"]') as HTMLInputElement;
    await typeInto(input, "装修");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onCreate).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("「放进…」浮出组列表，点一个回传 goalId", async () => {
    const onAssign = vi.fn();
    const { host, root } = await renderDom(createElement(TodoSelectionBar, { ...base, onAssign }));
    expect(host.querySelector('[aria-label="放进 搬家"]')).toBeNull();

    await click(host.querySelector('[aria-label="放进已有项目"]'));
    await click(host.querySelector('[aria-label="放进 搬家"]'));

    expect(onAssign).toHaveBeenCalledWith("g2");
    await unmount(root);
  });

  it("选完一个组后组列表立刻收起（让出被它盖住的那条 toast）", async () => {
    // 列表向上展开、不透明、最高 max-h-60，与待办页的 toast dock 占同一条带，且本栏在 DOM 里
    // 排 toast 之后（同为 z-backdrop）→ 后绘制的列表把失败 toast 完全盖住。
    // 归入失败刻意不退出多选、toast 是唯一的失败反馈通道，而列表不会自己收起、toast 6 秒就没了——
    // 用户合上列表时它早已消失，纯粹的「点了没反应」。
    const onAssign = vi.fn();
    const { host, root } = await renderDom(createElement(TodoSelectionBar, { ...base, onAssign }));
    await click(host.querySelector('[aria-label="放进已有项目"]'));
    expect(host.querySelector('[aria-label="放进 搬家"]')).not.toBeNull();

    await click(host.querySelector('[aria-label="放进 搬家"]'));

    expect(onAssign).toHaveBeenCalledWith("g2");
    expect(host.querySelector('[aria-label="放进 搬家"]')).toBeNull();
    await unmount(root);
  });

  it("一个项目都没有时不渲染「放进…」", async () => {
    const { host, root } = await renderDom(createElement(TodoSelectionBar, { ...base, projects: [] }));
    expect(host.querySelector('[aria-label="放进已有项目"]')).toBeNull();
    await unmount(root);
  });

  it("点取消回调 onCancel", async () => {
    const onCancel = vi.fn();
    const { host, root } = await renderDom(createElement(TodoSelectionBar, { ...base, onCancel }));
    await click(host.querySelector('[aria-label="取消多选"]'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("一条都没选时两个提交动作都不可用", async () => {
    const { host, root } = await renderDom(createElement(TodoSelectionBar, { ...base, selectedCount: 0 }));
    await typeInto(host.querySelector('[aria-label="项目名"]') as HTMLInputElement, "装修");
    expect((host.querySelector('[aria-label="圈成项目"]') as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector('[aria-label="放进已有项目"]') as HTMLButtonElement).disabled).toBe(true);
    await unmount(root);
  });
});
