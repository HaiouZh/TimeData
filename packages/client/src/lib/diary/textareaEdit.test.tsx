// @vitest-environment jsdom
import { act, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { applyEdit, previewEdit, runEditAction } from "./textareaEdit.js";

// 在任何测试对 HTMLTextAreaElement.prototype.value 做包装之前，先把真正原生的 descriptor
// 存一份模块级常量。stubExecCommand 与 countReactValueWrites 都必须用这一份，不能各自临时
// Object.getOwnPropertyDescriptor——护栏测试里两者会嵌套安装（counter 先装、stub 后装），
// 后装的一方若临时现查，拿到的就是"已被包过一层"的 descriptor，写值时会把自己那次写转发
// 给上一层的 setter，等于把桩自己的写也计成了 React 的写，护栏测试直接失真、测不出问题。
const NATIVE_TEXTAREA_VALUE = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "value",
) as PropertyDescriptor;

/**
 * jsdom 没有 document.execCommand（不是返回 false，是属性不存在、调用即抛）。
 * 这个桩用 HTMLTextAreaElement.prototype 上**原生**的 value setter 改值，绕开 React 的
 * value tracker，才能让 onChange 真被触发——与 DiaryPage.test.tsx 的 typeInto 同款手法。
 */
type Stub = { calls: Array<[string, string | undefined]>; restore(): void };

function stubExecCommand(field: HTMLTextAreaElement, mode: "ok" | "returns-false" | "throws" | "partial" = "ok"): Stub {
  const nativeValue = NATIVE_TEXTAREA_VALUE;
  const calls: Stub["calls"] = [];
  const impl = (command: string, _ui?: boolean, arg?: string): boolean => {
    calls.push([command, arg]);
    if (mode === "throws") throw new Error("execCommand failed");
    if (mode === "returns-false") return false;
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? 0;
    let next: string;
    let caret: number;
    if (command === "insertText") {
      const inserted = mode === "partial" ? (arg ?? "").slice(0, 1) : (arg ?? "");
      next = field.value.slice(0, start) + inserted + field.value.slice(end);
      caret = start + inserted.length;
    } else if (command === "delete") {
      // 忠实还原浏览器语义：光标折叠时 delete === 退格。applyEdit 若误把它用在
      // start===end 上，这个桩会当场吃掉前一个字符，测试变红——这正是我们要的。
      const from = start === end ? Math.max(0, start - 1) : start;
      next = field.value.slice(0, from) + field.value.slice(end);
      caret = from;
    } else return false;
    nativeValue.set?.call(field, next);
    field.setSelectionRange(caret, caret);
    field.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: command === "delete" ? "deleteContentBackward" : "insertText",
        data: arg,
      }),
    );
    return true;
  };
  Object.defineProperty(document, "execCommand", { value: impl, configurable: true, writable: true });
  return { calls, restore: () => Reflect.deleteProperty(document, "execCommand") };
}

function makeField(value: string): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  el.value = value;
  document.body.append(el);
  el.focus();
  return el;
}

afterEach(() => {
  // vi.restoreAllMocks() 清不掉 defineProperty 装上去的属性，必须显式删。
  Reflect.deleteProperty(document, "execCommand");
  document.body.innerHTML = "";
});

describe("previewEdit", () => {
  it("按 start/end 替换成 text", () => {
    expect(previewEdit("1. a", { kind: "replace", start: 4, end: 4, text: "\n2. ", selStart: 8, selEnd: 8 })).toBe(
      "1. a\n2. ",
    );
  });
});

describe("applyEdit", () => {
  it("插入走 insertText，值与光标都落到位", () => {
    const field = makeField("1. a");
    const stub = stubExecCommand(field);
    const result = applyEdit(field, { kind: "replace", start: 4, end: 4, text: "\n2. ", selStart: 8, selEnd: 8 });
    expect(result).toEqual({ ok: true, kind: "applied" });
    expect(stub.calls).toEqual([["insertText", "\n2. "]]);
    expect(field.value).toBe("1. a\n2. ");
    expect(field.selectionStart).toBe(8);
  });

  it("纯删除（start<end 且 text 为空）走 delete，不走 insertText", () => {
    const field = makeField("1. a\n2. ");
    const stub = stubExecCommand(field);
    const result = applyEdit(field, { kind: "replace", start: 5, end: 8, text: "", selStart: 5, selEnd: 5 });
    expect(result).toEqual({ ok: true, kind: "applied" });
    expect(stub.calls).toEqual([["delete", undefined]]);
    expect(field.value).toBe("1. a\n");
  });

  it("execCommand 抛异常时 rejected，fallbackValue 基于编辑前的值算", () => {
    const field = makeField("1. a");
    stubExecCommand(field, "throws");
    const result = applyEdit(field, { kind: "replace", start: 4, end: 4, text: "\n2. ", selStart: 8, selEnd: 8 });
    expect(result).toEqual({ ok: false, kind: "rejected", fallbackValue: "1. a\n2. " });
  });

  it("execCommand 只应用了一半时判 rejected，fallbackValue 仍是正确的整篇", () => {
    // 这条守的是「降级文本必须在 execCommand 之前算好」。若实现改成事后拿 field.value 算，
    // 这里会得到基于污染值的错误结果。
    const field = makeField("1. a");
    stubExecCommand(field, "partial");
    const result = applyEdit(field, { kind: "replace", start: 4, end: 4, text: "\n2. ", selStart: 8, selEnd: 8 });
    expect(result).toEqual({ ok: false, kind: "rejected", fallbackValue: "1. a\n2. " });
  });

  it("jsdom 原生没有 execCommand 时判 unsupported（不打桩）", () => {
    const field = makeField("1. a");
    const result = applyEdit(field, { kind: "replace", start: 4, end: 4, text: "\n2. ", selStart: 8, selEnd: 8 });
    expect(result).toEqual({ ok: false, kind: "unsupported", fallbackValue: "1. a\n2. " });
  });

  it("调 execCommand 之前选区恰是 [start,end) 且方向 backward", () => {
    const field = makeField("1. a\n2. b\n3. c");
    let seen: [number, number, string] | null = null;
    const nativeValue = NATIVE_TEXTAREA_VALUE;
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: (_c: string, _u?: boolean, arg?: string) => {
        seen = [field.selectionStart, field.selectionEnd, field.selectionDirection];
        nativeValue.set?.call(field, field.value.slice(0, 5) + (arg ?? "") + field.value.slice(14));
        return true;
      },
    });
    applyEdit(field, { kind: "replace", start: 5, end: 14, text: "2. B\n3. C", selStart: 9, selEnd: 9 });
    expect(seen).toEqual([5, 14, "backward"]);
  });
});

describe("runEditAction", () => {
  it("select 变体只挪光标：零 execCommand 调用、不写值、不置 dirty", () => {
    const field = makeField("[a](b)");
    const stub = stubExecCommand(field);
    let dirty = false;
    let written: string | null = null;
    runEditAction(
      field,
      { kind: "select", selStart: 4, selEnd: 5 },
      (v) => {
        written = v;
      },
      () => {
        dirty = true;
      },
    );
    expect(stub.calls).toEqual([]);
    expect(written).toBeNull();
    expect(dirty).toBe(false);
    expect([field.selectionStart, field.selectionEnd]).toEqual([4, 5]);
  });

  it("noop 变体什么都不做", () => {
    const field = makeField("a\nb");
    const stub = stubExecCommand(field);
    let dirty = false;
    runEditAction(
      field,
      { kind: "noop" },
      () => {
        throw new Error("不该写值");
      },
      () => {
        dirty = true;
      },
    );
    expect(stub.calls).toEqual([]);
    expect(dirty).toBe(false);
  });

  it("降级路径必须显式置 dirty（否则保存按钮永远不亮）", () => {
    // G2：execCommand 不可用时走 setValue，不经 onChange，dirty 没人置。
    const field = makeField("1. a");
    let dirty = false;
    let written: string | null = null;
    runEditAction(
      field,
      { kind: "replace", start: 4, end: 4, text: "\n2. ", selStart: 8, selEnd: 8 },
      (v) => {
        written = v;
      },
      () => {
        dirty = true;
      },
    );
    expect(written).toBe("1. a\n2. ");
    expect(dirty).toBe(true);
  });

  it("成功路径不碰 setValue / markDirty（交给 onChange）", () => {
    const field = makeField("1. a");
    stubExecCommand(field);
    runEditAction(
      field,
      { kind: "replace", start: 4, end: 4, text: "\n2. ", selStart: 8, selEnd: 8 },
      () => {
        throw new Error("成功路径不该调 setValue");
      },
      () => {
        throw new Error("成功路径不该调 markDirty");
      },
    );
    expect(field.value).toBe("1. a\n2. ");
  });
});

/**
 * 包 HTMLTextAreaElement.prototype 的 value setter 来数 React 写了几次。
 * 必须在 render **之前**安装：React 的 value tracker 在 initTextarea 里从
 * node.constructor.prototype 抓 descriptor，晚了就抓不到我们包过的那个。
 */
function countReactValueWrites() {
  const native = NATIVE_TEXTAREA_VALUE;
  const writes: string[] = [];
  Object.defineProperty(HTMLTextAreaElement.prototype, "value", {
    configurable: true,
    enumerable: native.enumerable,
    get: native.get,
    set(this: HTMLTextAreaElement, v: string) {
      writes.push(v);
      native.set?.call(this, v);
    },
  });
  return { writes, native, restore: () => Object.defineProperty(HTMLTextAreaElement.prototype, "value", native) };
}

function Probe() {
  const [v, setV] = useState("1. a");
  return <textarea aria-label="t" value={v} onChange={(e) => setV(e.target.value)} />;
}

describe("React 回写护栏", () => {
  it("onChange 原样回灌时 React 一次都不写 value（撤销栈得以保住）", async () => {
    // 必须先装计数器再 renderDom（内部 createRoot），否则 React 的 value tracker
    // 抓到的是原生 descriptor 而不是我们包过的那个，数不到写次数。
    const counter = countReactValueWrites();
    const { host, root } = await renderDom(<Probe />);
    const field = host.querySelector("textarea") as HTMLTextAreaElement;
    counter.writes.length = 0; // 忽略首次挂载的写
    const stub = stubExecCommand(field);
    await act(async () => {
      applyEdit(field, { kind: "replace", start: 4, end: 4, text: "\n2. ", selStart: 8, selEnd: 8 });
    });
    expect(field.value).toBe("1. a\n2. ");
    // 桩自己那一次写是通过 native setter 走的，不计入；这里数的纯粹是 React 的写。
    expect(counter.writes).toEqual([]);
    stub.restore();
    await unmount(root); // 漏了它 CI 并行下偶发 "window is not defined"
    counter.restore();
  });
});
