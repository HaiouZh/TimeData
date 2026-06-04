import { describe, expect, it } from "vitest";
import { pickCurrentDateLabel } from "./currentDate.js";

const dividers = [
  { label: "6月1日", offsetTop: 0 },
  { label: "6月2日", offsetTop: 200 },
  { label: "今天", offsetTop: 500 },
];

describe("pickCurrentDateLabel", () => {
  it("返回最后一个 offsetTop 不超过 scrollTop 的分隔标签", () => {
    expect(pickCurrentDateLabel(dividers, 250)).toBe("6月2日");
    expect(pickCurrentDateLabel(dividers, 520)).toBe("今天");
  });

  it("滚动在第一个分隔之上时回退到第一个标签", () => {
    expect(pickCurrentDateLabel(dividers, -10)).toBe("6月1日");
  });

  it("无分隔时返回 null", () => {
    expect(pickCurrentDateLabel([], 100)).toBeNull();
  });
});
