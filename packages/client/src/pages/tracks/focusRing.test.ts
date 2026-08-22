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

describe("pages/tracks 焦点态", () => {
  // 这道闸自己得先站得住：tracks 一半的控件在 workbench/ 子目录里，
  // 递归没生效的话闸会静默漏掉它们、扫出一份"全绿"的假结论。
  it("扫描范围覆盖 workbench 子目录", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.filter((f) => f.startsWith("workbench/")).length).toBeGreaterThanOrEqual(3);
  });

  // 1px 的 focus:ring 在暗底上跟静息边框几乎分不出，且 focus:（非 focus-visible）让鼠标点击也画环。
  // 两者都是「看不清焦点在哪」的直接成因，这道闸只准新代码走 focus-visible:ring-2。
  it("不残留 focus:ring-1 / 裸 focus: 焦点写法", () => {
    const offenders = sourceFiles().filter((name) => read(name).includes("focus:ring"));
    expect(offenders).toEqual([]);
  });

  // 环紧贴元素边缘会和 1px 边框糊在一起，2px 间隙才把两者分开。
  it("每个 focus-visible:ring-2 都配了 ring-offset-2", () => {
    const offenders: string[] = [];
    for (const name of sourceFiles()) {
      const src = read(name);
      const rings = (src.match(/focus-visible:ring-2/g) ?? []).length;
      const offsets = (src.match(/focus-visible:ring-offset-2/g) ?? []).length;
      if (rings !== offsets) offenders.push(`${name} (ring=${rings}, offset=${offsets})`);
    }
    expect(offenders).toEqual([]);
  });
});
