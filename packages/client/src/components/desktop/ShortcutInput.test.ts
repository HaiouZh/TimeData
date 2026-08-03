import { describe, expect, it } from "vitest";
import { normalizeShortcutFromKeyboardEvent, type ShortcutKeyEvent } from "./ShortcutInput.js";

// 纯函数按「结构」收参而不是收 DOM 的 KeyboardEvent：node 里没有 KeyboardEvent 构造器，
// 而真实调用方传进来的 React 合成事件 / 原生事件都结构兼容这个形状，故本闸能在 node 侧直测。
function keyEvent(init: Partial<ShortcutKeyEvent> & { key: string }): ShortcutKeyEvent {
  return { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init };
}

describe("normalizeShortcutFromKeyboardEvent", () => {
  it("修饰键 + 字母 → Tauri accelerator 格式（字母大写）", () => {
    expect(normalizeShortcutFromKeyboardEvent(keyEvent({ key: "p", ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+P");
  });

  it("Shift 与 Super 参与组合", () => {
    expect(normalizeShortcutFromKeyboardEvent(keyEvent({ key: "F1", shiftKey: true }))).toBe("Shift+F1");
    expect(normalizeShortcutFromKeyboardEvent(keyEvent({ key: "k", metaKey: true, ctrlKey: true }))).toBe(
      "Ctrl+Super+K",
    );
  });

  // 修饰键顺序必须由函数钉死、与按下顺序无关：同一组合每次都得录出同一个字符串，
  // 否则「设置页存的字符串」与「Rust 注册/回显时匹配的字符串」会对不上，红字回显永远找不到对应行。
  it("修饰键顺序固定为 Ctrl→Alt→Shift→Super", () => {
    expect(
      normalizeShortcutFromKeyboardEvent(
        keyEvent({ key: "p", metaKey: true, shiftKey: true, altKey: true, ctrlKey: true }),
      ),
    ).toBe("Ctrl+Alt+Shift+Super+P");
  });

  it("裸字母/数字拒绝（打字就会触发），裸 F 键放行", () => {
    expect(normalizeShortcutFromKeyboardEvent(keyEvent({ key: "p" }))).toBeNull();
    expect(normalizeShortcutFromKeyboardEvent(keyEvent({ key: "7" }))).toBeNull();
    expect(normalizeShortcutFromKeyboardEvent(keyEvent({ key: "F9" }))).toBe("F9");
  });

  it("纯修饰键按下不完成录入", () => {
    expect(normalizeShortcutFromKeyboardEvent(keyEvent({ key: "Control", ctrlKey: true }))).toBeNull();
    expect(normalizeShortcutFromKeyboardEvent(keyEvent({ key: "Shift", shiftKey: true }))).toBeNull();
    expect(normalizeShortcutFromKeyboardEvent(keyEvent({ key: "Alt", altKey: true }))).toBeNull();
    expect(normalizeShortcutFromKeyboardEvent(keyEvent({ key: "Meta", metaKey: true }))).toBeNull();
  });

  it("空格与方向键规范化为 Tauri 名称", () => {
    expect(normalizeShortcutFromKeyboardEvent(keyEvent({ key: " ", ctrlKey: true }))).toBe("Ctrl+Space");
    expect(normalizeShortcutFromKeyboardEvent(keyEvent({ key: "ArrowUp", ctrlKey: true, altKey: true }))).toBe(
      "Ctrl+Alt+Up",
    );
  });
});
