import { describe, expect, it } from "vitest";
import { subtaskProgress } from "./subtasks.js";

describe("subtaskProgress", () => {
  it("无子任务 -> null（不渲染进度条）", () => {
    expect(subtaskProgress(0, 0)).toBeNull();
  });

  it("部分完成 -> 比例", () => {
    expect(subtaskProgress(1, 4)).toBe(0.25);
  });

  it("全部完成 -> 1", () => {
    expect(subtaskProgress(3, 3)).toBe(1);
  });

  it("done 超过 total -> 夹取到 1", () => {
    expect(subtaskProgress(5, 3)).toBe(1);
  });

  it("done 为负 -> 夹取到 0", () => {
    expect(subtaskProgress(-1, 3)).toBe(0);
  });
});
