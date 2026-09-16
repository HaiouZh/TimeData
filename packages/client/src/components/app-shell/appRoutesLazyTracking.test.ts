import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AppRoutes.tsx", import.meta.url), "utf8");

describe("路由懒加载全部经登记", () => {
  // 逃逸变异：新加一个页面直接写 lazy(() => import(...)) → 这个页面挂住时诊断点不了名。
  it("每个 lazy( 都包着 trackLazyLoad(", () => {
    const lazyCalls = source.match(/\blazy\(/g) ?? [];
    const tracked = source.match(/\blazy\(\s*trackLazyLoad\(/g) ?? [];
    expect(lazyCalls.length).toBeGreaterThan(0);
    expect(tracked.length).toBe(lazyCalls.length);
  });

  it("登记名与常量名一致（报告里点名要能对回页面）", () => {
    const pairs = [...source.matchAll(/const (\w+) = lazy\(\s*trackLazyLoad\("(\w+)"/g)];
    expect(pairs.length).toBeGreaterThan(0);
    for (const [, constName, trackedName] of pairs) expect(trackedName).toBe(constName);
  });
});
