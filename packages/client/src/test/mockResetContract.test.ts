import { describe, expect, it, vi } from "vitest";

// 桶级 afterEach 的清理契约回归测试。
//
// 背景：Vitest 3 起 vi.restoreAllMocks() 只还原 vi.spyOn 装的间谍，不再清 vi.fn() 的调用历史。
// 三个桶的 setup 曾只调 restoreAllMocks，于是「上一条用例调用过某 mock」会泄漏成下一条的
// toHaveBeenCalled 脏数据。默认顺序下未必暴露，--sequence.shuffle 一换序就随机翻车
// （实测炸点：QuickNotesPage「空日导出不生成文件只提示」被同文件「Markdown 导出成功提示带条数」污染）。
//
// 本文件按声明顺序跑：A 先调用、B 断言干净。撤掉 setup 里的 clearAllMocks，B 必红。

const moduleLevelMock = vi.fn(async () => {});
const spyTarget = { impl: () => "real" };

describe("桶级 afterEach 的 mock 清理契约", () => {
  it("A：调用一次模块级 vi.fn，并装一个 spy", () => {
    void moduleLevelMock();
    vi.spyOn(spyTarget, "impl").mockReturnValue("mocked");

    expect(moduleLevelMock).toHaveBeenCalledTimes(1);
    expect(spyTarget.impl()).toBe("mocked");
  });

  it("B：上一条的 vi.fn 调用历史与 spy 都不该泄漏到这里", () => {
    // spy 还原由 restoreAllMocks 负责
    expect(spyTarget.impl()).toBe("real");
    // 调用历史清空由 clearAllMocks 负责——少了它这条必红
    expect(moduleLevelMock).not.toHaveBeenCalled();
  });
});
