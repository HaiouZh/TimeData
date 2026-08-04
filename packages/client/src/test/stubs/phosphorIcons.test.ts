import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as stub from "./phosphorIcons.js";

// 守 stub 与真实用量同步：vitest.config.ts 把 @phosphor-icons/react 整体 alias 到本 stub，
// 新代码引了 stub 里没有的图标时，症状是该测试文件报一个语焉不详的 undefined 组件。
// 这条闸把它提前成一句明确的「缺哪个图标」，顺带反向抓出 stub 里已无人使用的死图标。

const SRC = fileURLToPath(new URL("../../", import.meta.url));

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(name)) acc.push(full);
  }
  return acc;
}

/** 代码里从 @phosphor-icons/react 具名 import 的图标（跳过 `import type`——类型不需要运行时导出）。 */
function collectUsedIcons(): Set<string> {
  const used = new Set<string>();
  for (const file of walk(SRC)) {
    // stub 自身与本测试不算用量
    if (file.includes(join("test", "stubs"))) continue;
    const text = readFileSync(file, "utf8");
    const re = /import\s+(type\s+)?\{([^}]+)\}\s+from\s+["']@phosphor-icons\/react["']/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const isTypeOnlyImport = Boolean(match[1]);
      for (const raw of match[2].split(",")) {
        const spec = raw.trim();
        if (!spec) continue;
        // `type Icon as PhosphorIcon` / `Icon as PhosphorIcon` 都取原名，并跳过逐项 type 修饰
        const isTypeOnlySpecifier = /^type\s/.test(spec);
        if (isTypeOnlyImport || isTypeOnlySpecifier) continue;
        const name = spec.replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
        if (name) used.add(name);
      }
    }
  }
  return used;
}

describe("phosphor 图标 stub", () => {
  it("覆盖代码里实际用到的每一个图标", () => {
    const used = [...collectUsedIcons()].sort();
    const missing = used.filter((name) => !(name in stub));

    expect(missing, `stub 缺这些图标，补进 src/test/stubs/phosphorIcons.tsx：${missing.join(", ")}`).toEqual([]);
  });

  it("没有已无人使用的死图标", () => {
    const used = collectUsedIcons();
    const exported = Object.keys(stub).filter((key) => typeof stub[key as keyof typeof stub] === "function");
    const dead = exported.filter((name) => !used.has(name)).sort();

    expect(dead, `stub 里这些图标已无人使用，可从 phosphorIcons.tsx 删除：${dead.join(", ")}`).toEqual([]);
  });
});
