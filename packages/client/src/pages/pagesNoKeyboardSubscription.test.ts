import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// pages/ 顶层的每一个页面文件都在闸内（子目录是页面私有组件，叶子可以订阅）；测试文件排除——
// 它们 mock 键盘 hook 时会写出同样的调用串。
const pageFiles = readdirSync(new URL("./", import.meta.url))
  .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
  .map((f) => `./${f}`);

/**
 * mobile-keyboard R8 闸：页面根不得订阅键盘状态。任何一处 useKeyboard* 挂回页面组件，
 * 键盘弹起就会整页重渲染（真机 ff ≈ 200ms，design §0.2）。键盘量只在叶子里取
 *（KeyboardInsetPad / KeyboardInsetSlot / KeyboardDock / KeyboardNavCollapse 四个组件）；
 * 页面根连 `useBottomInset` / `useKeyboardMotion` 也不许调——前者内部订阅三个键盘 hook。
 */
describe("页面根不订阅键盘", () => {
  it("顶层页面清单非空（防目录读错静默变成空集）", () => {
    expect(pageFiles.length).toBeGreaterThanOrEqual(10);
  });
  it.each(pageFiles)("%s 不直接调用键盘 hook", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/useKeyboardHeight\(/);
    expect(src).not.toMatch(/useKeyboardHeightSettled\(/);
    expect(src).not.toMatch(/useKeyboardVisible\(/);
    expect(src).not.toMatch(/useKeyboardNavCollapse\(/);
    expect(src).not.toMatch(/useBottomInset\(/);
    expect(src).not.toMatch(/useKeyboardMotion\(/);
  });
});
