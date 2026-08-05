// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard.js";

afterEach(() => {
  vi.restoreAllMocks();
  // 裸 defineProperty 桩不在 restoreAllMocks/unstubAllGlobals 管辖内；isolate:false 下 jsdom
  // 环境跨文件共享，不显式摘除会把 execCommand（返回 true）与 clipboard 泄漏给同 worker 的后续文件——
  // 曾让 TaskRow 的「clipboard 拒绝且 DOM 兜底失败」用例拿到能成功的兜底而翻红。
  Reflect.deleteProperty(document, "execCommand");
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("copyText", () => {
  it("uses navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    await copyText("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to a hidden textarea when navigator clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });

    await copyText("fallback");

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back when navigator.clipboard.writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });

    await copyText("fallback-after-reject");

    expect(writeText).toHaveBeenCalledWith("fallback-after-reject");
    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});
