import { beforeEach, describe, expect, it } from "vitest";
import { LAZY_SNAPSHOT_MAX, resetLazyRegistry, snapshotInFlightLazy, trackLazyLoad } from "./lazyRegistry.ts";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(resetLazyRegistry);

describe("在途懒加载登记", () => {
  it("factory 调用后在册，resolve 后出册，值原样透传", async () => {
    let t = 1000;
    const d = deferred<{ default: string }>();
    const load = trackLazyLoad("TodoPage", () => d.promise, () => t);
    const pending = load();
    t = 1300;
    expect(snapshotInFlightLazy(() => t)).toEqual([["TodoPage", 300]]);
    d.resolve({ default: "ok" });
    await expect(pending).resolves.toEqual({ default: "ok" });
    expect(snapshotInFlightLazy(() => t)).toEqual([]);
  });

  // 逃逸变异：只在 resolve 时出册 → reject 的页面永远挂在册里，被误点名为乙的凶手。
  it("reject 后也出册，且错误照样抛给调用方（错误边界要看得见）", async () => {
    const d = deferred<{ default: string }>();
    const pending = trackLazyLoad("StatsPage", () => d.promise, () => 0)();
    d.reject(new Error("chunk failed"));
    await expect(pending).rejects.toThrow("chunk failed");
    expect(snapshotInFlightLazy(() => 0)).toEqual([]);
  });

  it("factory 同步抛错：不留在册，错误原样抛", () => {
    const load = trackLazyLoad("X", () => {
      throw new Error("sync");
    });
    expect(() => load()).toThrow("sync");
    expect(snapshotInFlightLazy(() => 0)).toEqual([]);
  });

  it("快照按等待时长倒序，最多取 3 条", () => {
    const names = ["A", "B", "C", "D"];
    names.forEach((name, i) => {
      trackLazyLoad(name, () => new Promise(() => {}), () => i * 100)();
    });
    expect(LAZY_SNAPSHOT_MAX).toBe(3);
    expect(snapshotInFlightLazy(() => 1000)).toEqual([
      ["A", 1000],
      ["B", 900],
      ["C", 800],
    ]);
  });
});
