// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, pressKey, renderDom, unmount } from "../../test/domHarness.js";
import { OverflowMenu } from "./OverflowMenu.js";

afterEach(() => vi.restoreAllMocks());

function items(onSelect = () => {}) {
  return [
    { key: "edit", label: "编辑轨道", onSelect },
    { key: "remove", label: "删除轨道", onSelect, danger: true },
  ];
}

describe("OverflowMenu", () => {
  it("默认收起：菜单项不渲染", async () => {
    const { host, root } = await renderDom(createElement(OverflowMenu, { items: items() }));
    expect(host.textContent).not.toContain("删除轨道");
    expect(host.querySelector("[aria-haspopup='menu']")?.getAttribute("aria-expanded")).toBe("false");
    await unmount(root);
  });

  it("点触发器展开，aria-expanded 转 true", async () => {
    const { host, root } = await renderDom(createElement(OverflowMenu, { items: items() }));
    await click(host.querySelector("[aria-haspopup='menu']"));
    expect(host.textContent).toContain("删除轨道");
    expect(host.querySelector("[aria-haspopup='menu']")?.getAttribute("aria-expanded")).toBe("true");
    await unmount(root);
  });

  it("Escape 关闭", async () => {
    const { host, root } = await renderDom(createElement(OverflowMenu, { items: items() }));
    await click(host.querySelector("[aria-haspopup='menu']"));
    expect(host.textContent).toContain("删除轨道");
    await pressKey("Escape");
    expect(host.textContent).not.toContain("删除轨道");
    await unmount(root);
  });

  it("点击面板外关闭", async () => {
    const { host, root } = await renderDom(createElement(OverflowMenu, { items: items() }));
    await click(host.querySelector("[aria-haspopup='menu']"));
    expect(host.textContent).toContain("删除轨道");
    await click(document.body);
    expect(host.textContent).not.toContain("删除轨道");
    await unmount(root);
  });

  it("选中项后回调并关闭", async () => {
    const onSelect = vi.fn();
    const { host, root } = await renderDom(createElement(OverflowMenu, { items: items(onSelect) }));
    await click(host.querySelector("[aria-haspopup='menu']"));
    const remove = [...host.querySelectorAll("[role='menuitem']")].find((el) =>
      el.textContent?.includes("删除轨道"),
    );
    await click(remove);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("删除轨道");
    await unmount(root);
  });

  it("danger 项带 text-danger，disabled 项不可点", async () => {
    const onSelect = vi.fn();
    const { host, root } = await renderDom(
      createElement(OverflowMenu, {
        items: [
          { key: "remove", label: "删除轨道", onSelect, danger: true },
          { key: "up", label: "上移", onSelect, disabled: true },
        ],
      }),
    );
    await click(host.querySelector("[aria-haspopup='menu']"));
    const all = [...host.querySelectorAll("[role='menuitem']")];
    const remove = all.find((el) => el.textContent?.includes("删除轨道"));
    const up = all.find((el) => el.textContent?.includes("上移"));
    expect(remove?.className).toContain("text-danger");
    expect((up as HTMLButtonElement).disabled).toBe(true);
    await click(up);
    expect(onSelect).not.toHaveBeenCalled();
    await unmount(root);
  });
});
