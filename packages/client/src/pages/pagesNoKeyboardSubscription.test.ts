import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * mobile-keyboard R8 闸：页面根不得订阅键盘状态。任何一处 useKeyboard* 挂回页面组件，
 * 键盘弹起就会整页重渲染（真机 ff ≈ 200ms，design §0.2）。键盘量只在叶子里取：
 * KeyboardInsetPad / KeyboardInsetSlot / KeyboardDock / KeyboardNavCollapse。
 */
describe("页面根不订阅键盘", () => {
  it.each(["./TodoPage.tsx", "./QuickNotesPage.tsx"])("%s 不直接调用键盘 hook", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/useKeyboardHeight\(/);
    expect(src).not.toMatch(/useKeyboardHeightSettled\(/);
    expect(src).not.toMatch(/useKeyboardVisible\(/);
    expect(src).not.toMatch(/useKeyboardNavCollapse\(/);
  });
});
