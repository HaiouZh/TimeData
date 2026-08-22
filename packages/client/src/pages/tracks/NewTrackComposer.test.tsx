// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { NewTrackComposer } from "./NewTrackComposer.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

async function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("NewTrackComposer", () => {
  it("submits a trimmed title and clears the field", async () => {
    const onCreate = vi.fn();
    mounted = await renderDom(<NewTrackComposer onCreate={onCreate} />);
    const host = mounted.host;
    await click(host.querySelector("[data-testid='new-track-open']"));
    const input = host.querySelector("input") as HTMLInputElement;
    await typeInto(input, "  新轨道  ");
    await submit(host.querySelector("form") as HTMLFormElement);
    expect(onCreate).toHaveBeenCalledWith("新轨道");
    // 提交成功后收回；再点开必须是空的——原用例守的是"草稿不残留到下次"，
    // 只断言"收回了"会把这一半悄悄丢掉。
    expect(host.querySelector("input")).toBeNull();
    await click(host.querySelector("[data-testid='new-track-open']"));
    expect((host.querySelector("input") as HTMLInputElement).value).toBe("");
  });

  it("ignores blank submissions", async () => {
    const onCreate = vi.fn();
    mounted = await renderDom(<NewTrackComposer onCreate={onCreate} />);
    await click(mounted.host.querySelector("[data-testid='new-track-open']"));
    await submit(mounted.host.querySelector("form") as HTMLFormElement);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("默认只有入口按钮，点开才出输入框", async () => {
    const onCreate = vi.fn();
    mounted = await renderDom(<NewTrackComposer onCreate={onCreate} />);
    const host = mounted.host;
    expect(host.querySelector("input")).toBeNull();
    expect(host.querySelector("form")).toBeNull();
    await click(host.querySelector("[data-testid='new-track-open']"));
    expect(host.querySelector("input")).not.toBeNull();
  });

  it("空输入失焦收回，有内容失焦保持展开", async () => {
    const onCreate = vi.fn();
    mounted = await renderDom(<NewTrackComposer onCreate={onCreate} />);
    const host = mounted.host;

    await click(host.querySelector("[data-testid='new-track-open']"));
    const empty = host.querySelector("input") as HTMLInputElement;
    // React 的 onBlur 委托到原生 focusout（blur 本身不冒泡，委托不到）。
    // 派发 blur 在 React 19 下什么都不会发生——那样这条用例既红不了也绿不了。
    await act(async () => {
      empty.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(host.querySelector("input")).toBeNull();

    await click(host.querySelector("[data-testid='new-track-open']"));
    const typed = host.querySelector("input") as HTMLInputElement;
    await typeInto(typed, "打了一半");
    await act(async () => {
      typed.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    // 打了一半点别处不该把草稿弄没——这是「空才收回」这条判据存在的唯一理由。
    expect(host.querySelector("input")).not.toBeNull();
    expect((host.querySelector("input") as HTMLInputElement).value).toBe("打了一半");
  });
});
