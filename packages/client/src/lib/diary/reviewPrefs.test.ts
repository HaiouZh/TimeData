import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "../storageKeys.js";
import {
  getReviewLayoutB,
  getReviewMode,
  getReviewYearRange,
  setReviewLayoutB,
  setReviewMode,
  setReviewYearRange,
} from "./reviewPrefs.js";

beforeEach(() => {
  localStorage.clear();
});

describe("reviewPrefs", () => {
  it("年份跨度：未设默认 5", () => {
    expect(getReviewYearRange()).toBe(5);
  });

  it("年份跨度：写入后可读回", () => {
    setReviewYearRange(3);
    expect(getReviewYearRange()).toBe(3);
    expect(localStorage.getItem(STORAGE_KEYS.diaryReviewYearRange)).toBe("3");
  });

  it("年份跨度：钳到 1-10", () => {
    setReviewYearRange(0);
    expect(getReviewYearRange()).toBe(1);
    setReviewYearRange(99);
    expect(getReviewYearRange()).toBe(10);
  });

  it("年份跨度：坏值回默认", () => {
    localStorage.setItem(STORAGE_KEYS.diaryReviewYearRange, "not-a-number");
    expect(getReviewYearRange()).toBe(5);
  });

  it("模式：未设默认 A", () => {
    expect(getReviewMode()).toBe("A");
  });

  it("模式：写入后可读回", () => {
    setReviewMode("C");
    expect(getReviewMode()).toBe("C");
  });

  it("模式：坏值回默认", () => {
    localStorage.setItem(STORAGE_KEYS.diaryReviewMode, "Z");
    expect(getReviewMode()).toBe("A");
  });

  it("模式 B 布局：未设默认 grid", () => {
    expect(getReviewLayoutB()).toBe("grid");
  });

  it("模式 B 布局：写入后可读回", () => {
    setReviewLayoutB("list");
    expect(getReviewLayoutB()).toBe("list");
  });

  it("模式 B 布局：坏值回默认", () => {
    localStorage.setItem(STORAGE_KEYS.diaryReviewLayoutB, "bogus");
    expect(getReviewLayoutB()).toBe("grid");
  });
});
