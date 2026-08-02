import { describe, expect, it } from "vitest";
import { pickCurrentDateDivider, pickCurrentDateLabel, findStuckDivider } from "./currentDate.js";

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

  it("返回当前分隔项，保留额外日期值", () => {
    const richDividers = [
      { label: "6月1日", localDate: "2026-06-01", offsetTop: 0 },
      { label: "6月2日", localDate: "2026-06-02", offsetTop: 200 },
    ];

    expect(pickCurrentDateDivider(richDividers, 250)).toEqual({
      label: "6月2日",
      localDate: "2026-06-02",
      offsetTop: 200,
    });
  });

  it("滚动在第一个分隔之上时回退到第一个标签", () => {
    expect(pickCurrentDateLabel(dividers, -10)).toBe("6月1日");
  });

  it("无分隔时返回 null", () => {
    expect(pickCurrentDateLabel([], 100)).toBeNull();
  });
});

const H = 28; // 日期药丸行高，取值不影响判定逻辑，只要各用例内自洽

describe("findStuckDivider", () => {
  it("命中正粘在顶部的那条", () => {
    const dividers = [
      { label: "6月1日", top: -10, height: H },
      { label: "6月2日", top: 300, height: H },
    ];
    expect(findStuckDivider(dividers, 8)?.label).toBe("6月1日");
  });

  it("已被完全顶出视口的不再命中", () => {
    expect(findStuckDivider([{ label: "6月1日", top: -40, height: H }], 8)).toBeNull();
  });

  it("还没滚到粘住位置的不命中", () => {
    expect(findStuckDivider([{ label: "6月1日", top: 200, height: H }], 8)).toBeNull();
  });

  it("恰好停在粘住位置时命中（上界含等号）", () => {
    expect(findStuckDivider([{ label: "今天", top: 8, height: H }], 8)?.label).toBe("今天");
  });

  it("恰好到被顶出的临界点时仍命中（下界含等号）", () => {
    expect(findStuckDivider([{ label: "今天", top: -H, height: H }], 8)?.label).toBe("今天");
  });

  it("两条同时落在区间时取更早的那条——它正被下一条顶出，此刻仍占着顶部", () => {
    const dividers = [
      { label: "6月1日", top: -20, height: H },
      { label: "6月2日", top: 5, height: H },
    ];
    expect(findStuckDivider(dividers, 8)?.label).toBe("6月1日");
  });

  it("空列表返回 null", () => {
    expect(findStuckDivider([], 8)).toBeNull();
  });
});
