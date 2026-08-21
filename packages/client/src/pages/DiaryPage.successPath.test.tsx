// @vitest-environment jsdom
import { createElement, act as reactAct } from "react";
import { flushSync } from "react-dom";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";
import DiaryPage from "./DiaryPage.js";

// 本文件补两个结构性空档（见 docs/evergreen/diary/editor.md §5、lib/diary/textareaEdit.ts 顶部注释）：
//
// 1) 生产环境唯一真正走的那条路径（document.execCommand 可用）此前在页面级零覆盖。jsdom 没有
//    execCommand，DiaryPage.test.tsx 的全部用例走的都是"execCommand 不可用 → setValue 整体
//    回写"的降级路径；execCommand 成功路径此前只有 textareaEdit.test.tsx 里对着一个等价 Probe
//    组件（不是 DiaryPage 本体）的打桩测试覆盖。下面这条测试用桩把 jsdom 缺的 execCommand
//    补上，让 DiaryPage 本体真的走一遍生产路径。
//
// 2) onChange 红线（§3.5）此前被记录为"唯一机检是 textareaEdit.test.tsx 内部的 Probe 组件，
//    守不到 DiaryPage.tsx 本体，只能靠 review 兜底"。下面这条测试把同一套"React 写回计数器"
//    手法接到 DiaryPage 本体上，实测证明其实可以机检：往 DiaryPage.tsx 的 onChange 加一个
//    .trimEnd() 就会让这条测试当场变红（证伪记录见 .superpowers/sdd/task-9-report.md）。

const fetchDiaryConfig = vi.fn();
const fetchDiary = vi.fn();
const saveDiary = vi.fn();
vi.mock("../lib/diary/diaryApi.ts", async () => {
  const actual = await vi.importActual<typeof import("../lib/diary/diaryApi.js")>("../lib/diary/diaryApi.ts");
  return {
    ...actual,
    fetchDiaryConfig: (...args: unknown[]) => fetchDiaryConfig(...args),
    fetchDiary: (...args: unknown[]) => fetchDiary(...args),
    saveDiary: (...args: unknown[]) => saveDiary(...args),
  };
});

// 必须在任何测试包装 value setter 之前存一份原生 descriptor——与 textareaEdit.test.tsx 同款
// 理由：countReactValueWrites 与 stubExecCommand 若各自临时现查 descriptor，后装的一方会拿到
// "已被前一层包过"的 setter，把对方那次写也转发计数进去，护栏测试直接失真、测不出问题。
const NATIVE_TEXTAREA_VALUE = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "value",
) as PropertyDescriptor;

/** 包 HTMLTextAreaElement.prototype 的 value setter 来数 React 写了几次。必须在 render 之前安装。 */
function countReactValueWrites() {
  const writes: string[] = [];
  Object.defineProperty(HTMLTextAreaElement.prototype, "value", {
    configurable: true,
    enumerable: NATIVE_TEXTAREA_VALUE.enumerable,
    get: NATIVE_TEXTAREA_VALUE.get,
    set(this: HTMLTextAreaElement, v: string) {
      writes.push(v);
      NATIVE_TEXTAREA_VALUE.set?.call(this, v);
    },
  });
  return {
    writes,
    restore: () => Object.defineProperty(HTMLTextAreaElement.prototype, "value", NATIVE_TEXTAREA_VALUE),
  };
}

/**
 * jsdom 没有 document.execCommand（不是返回 false，是属性不存在、调用即抛）。这个桩只实现
 * "ok" 一种模式（insertText 成功）——够撑起一条成功路径正测；与 textareaEdit.test.tsx 的
 * stubExecCommand 同一手法：改值走**原生** setter（绕开上面装的计数器），再发一个真 input
 * 事件，让 React 的 onChange 真被触发——这与浏览器里 execCommand 的实际行为同构。
 */
function stubExecCommand(field: HTMLTextAreaElement) {
  const impl = (command: string, _showUi?: boolean, arg?: string): boolean => {
    if (command !== "insertText") return false;
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? 0;
    const inserted = arg ?? "";
    NATIVE_TEXTAREA_VALUE.set?.call(field, field.value.slice(0, start) + inserted + field.value.slice(end));
    field.setSelectionRange(start + inserted.length, start + inserted.length);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: arg }));
    return true;
  };
  Object.defineProperty(document, "execCommand", { value: impl, configurable: true, writable: true });
  return { restore: () => Reflect.deleteProperty(document, "execCommand") };
}

// 本地 flushSync 版 act：同 DiaryPage.test.tsx，套一层真正的 React act 让 mock Promise 的
// resolve/continuation 也算数，否则会报 "not wrapped in act(...)"。
async function act(callback: () => Promise<void> | void) {
  await reactAct(async () => {
    let result: Promise<void> | void;
    flushSync(() => {
      result = callback();
    });
    await result;
    flushSync(() => {});
  });
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 10; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

beforeEach(() => {
  fetchDiaryConfig.mockReset();
  fetchDiary.mockReset();
  saveDiary.mockReset();
  fetchDiaryConfig.mockResolvedValue({ enabled: true, template: "1. ", guideItems: "" });
  fetchDiary.mockResolvedValue({ content: "1. x", mtime: 100 });
  document.body.innerHTML = "";
});

describe("DiaryPage · execCommand 成功路径（页面级，此前零覆盖）", () => {
  it("真实 execCommand 路径下 Enter 续号：文本正确落地，且 React 一次都不写回 value（onChange 红线守到 DiaryPage 本体）", async () => {
    const counter = countReactValueWrites();
    try {
      const router = createMemoryRouter([{ path: "/diary", element: createElement(DiaryPage) }], {
        initialEntries: ["/diary"],
      });
      const { host, root } = await renderDom(createElement(RouterProvider, { router }));
      await flush();
      const field = host.querySelector("textarea") as HTMLTextAreaElement;
      counter.writes.length = 0; // 忽略首次挂载的写
      const stub = stubExecCommand(field);
      try {
        field.setSelectionRange(4, 4); // "1. x" 行尾
        await act(async () => {
          field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        });
        await flush();

        // 文本正确性顺带证明 execCommand 分支真的被走到了：桩没起作用（比如键位分支断线）
        // 会让 value 原样不动，这条断言会先红，不会让下面的计数器断言假绿地"蒙对"。
        expect(field.value).toBe("1. x\n2. ");
        // 桩自己那次写用的是原生 setter，不计数；这里数的纯粹是 React 的写——一次都不该有，
        // 否则说明 onChange 加工过 value，原生撤销栈在真实浏览器里已经被整体回写清空了。
        expect(counter.writes).toEqual([]);
      } finally {
        stub.restore();
        await unmount(root);
      }
    } finally {
      counter.restore();
    }
  });
});
