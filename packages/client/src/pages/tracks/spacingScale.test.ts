import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tracksDir = fileURLToPath(new URL("./", import.meta.url));

function sourceFiles(): string[] {
  return readdirSync(tracksDir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
    .map((name) => name.replaceAll("\\", "/"))
    .sort();
}

function read(name: string): string {
  return readFileSync(`${tracksDir}${name}`, "utf8").replaceAll("\r\n", "\n");
}

// R2 间距四档 4/8/16/24（Tailwind 1/2/4/6）：整页只用这四个节拍，眼睛才分得出
// 「这两块是一组」和「这两块各是一组」。2026-08-22 诊断时详情页在同屏用着九种间距值。
//
// 两条豁免，都不是妥协而是不同性质的东西：
// ① 横向 12px（px-3 / pl-3 / pr-3）——输入控件的内边距是全项目惯例（`px-3 py-2`），
//    不止 tracks 页在用，本批不改它；
// ② 页面级大留白（pb-24 安全区、py-16 空态）——那是版面留白，不是元素间的节拍。
const HALF_STEP =
  /\b(?:m|mt|mb|ml|mr|mx|my|p|pt|pb|pl|pr|px|py|gap|gap-x|gap-y|space-x|space-y)-\d+\.5\b/;
const THREE_STEP = /\b(?:m|mt|mb|ml|mr|mx|my|p|pt|pb|py|gap|gap-x|gap-y|space-x|space-y)-3\b/;

describe("pages/tracks 间距四档", () => {
  // 这道闸自己得先站得住：tracks 一半的组件在 workbench/ 子目录里，
  // 递归没生效的话闸会静默漏掉它们、扫出一份「全绿」的假结论。
  it("扫描范围覆盖 workbench 子目录", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.filter((f) => f.startsWith("workbench/")).length).toBeGreaterThanOrEqual(3);
  });

  it("不出现 .5 档间距", () => {
    const offenders = sourceFiles().filter((name) => HALF_STEP.test(read(name)));
    expect(offenders).toEqual([]);
  });

  it("不出现纵向/外边距/间隙的 12px 档（横向 px-3 除外）", () => {
    const offenders = sourceFiles().filter((name) => THREE_STEP.test(read(name)));
    expect(offenders).toEqual([]);
  });
});
