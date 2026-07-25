// @vitest-environment jsdom
import { createElement, useState } from "react";
import { describe, expect, it } from "vitest";
import { click, renderDom, unmount } from "../test/domHarness.js";
import { useConfirm } from "./useConfirm.js";

/**
 * 顶替语义的最小复现：真实 UI 里 ConfirmSheet 是全屏模态挡住页内其他按钮，够不到
 * 「第二次 confirm() 顶替第一次」这条路径，但 `.click()` 在 jsdom 里不做命中测试，
 * 程序化点击能绕过视觉遮挡直接触发——这正是本用例要覆盖的层级（hook 语义，非像素点击）。
 */
function ConfirmHarness() {
  const { confirm, dialog } = useConfirm();
  const [r1, setR1] = useState("pending");
  const [r2, setR2] = useState("pending");
  return createElement(
    "div",
    null,
    dialog,
    createElement(
      "button",
      {
        type: "button",
        onClick: () => {
          void confirm({ title: "第一个请求", body: "a" }).then((ok) => setR1(String(ok)));
        },
      },
      "发起A",
    ),
    createElement(
      "button",
      {
        type: "button",
        onClick: () => {
          void confirm({ title: "第二个请求", body: "b" }).then((ok) => setR2(String(ok)));
        },
      },
      "发起B",
    ),
    createElement("span", null, `r1:${r1}`),
    createElement("span", null, `r2:${r2}`),
  );
}

function findButton(host: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing button: ${label}`);
  return found;
}

describe("useConfirm", () => {
  it("第二次 confirm() 顶替第一次挂起请求时，第一个 promise 结算为 false 而非悬空", async () => {
    const { host, root } = await renderDom(createElement(ConfirmHarness));

    await click(findButton(host, "发起A"));
    expect(host.textContent).toContain("第一个请求");

    // 第一个请求尚未回应，第二次调用顶替它——修复前这里会让第一个 promise 永久悬空。
    await click(findButton(host, "发起B"));

    expect(host.textContent).toContain("r1:false");
    expect(host.textContent).toContain("第二个请求");
    expect(host.textContent).not.toContain("第一个请求");

    // 第二个请求正常走完：确认弹层的行为不受顶替逻辑影响。
    await click(findButton(host, "确认"));
    expect(host.textContent).toContain("r2:true");

    await unmount(root);
  });
});
