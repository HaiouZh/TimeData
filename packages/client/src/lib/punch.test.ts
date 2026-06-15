import { describe, expect, it } from "vitest";
import { resolvePunchRange } from "./punch.js";

// 全部用 UTC ISO 字符串；APP 时区 +08:00，今天 0 点 = 前一日 16:00Z。
const TODAY_START = "2026-06-14T16:00:00.000Z"; // 2026-06-15 00:00 (+08:00)
const NOW = "2026-06-15T04:00:00.000Z"; // 2026-06-15 12:00 (+08:00)

describe("resolvePunchRange", () => {
  it("今天有记录时，起点=今天最后一条 end", () => {
    const lastEnd = "2026-06-15T02:00:00.000Z"; // 今天 10:00
    expect(resolvePunchRange(NOW, TODAY_START, lastEnd)).toEqual({ startTime: lastEnd, endTime: NOW });
  });

  it("今天没有记录（最后一条结束于昨天）时，起点=今天 0 点", () => {
    const lastEnd = "2026-06-14T15:00:00.000Z"; // 昨天 23:00
    expect(resolvePunchRange(NOW, TODAY_START, lastEnd)).toEqual({ startTime: TODAY_START, endTime: NOW });
  });

  it("完全没有任何记录时，起点=今天 0 点", () => {
    expect(resolvePunchRange(NOW, TODAY_START, null)).toEqual({ startTime: TODAY_START, endTime: NOW });
  });

  it("起点不早于 now（无时间可记）时返回 null", () => {
    const lastEnd = NOW; // 上一条恰好结束于现在
    expect(resolvePunchRange(NOW, TODAY_START, lastEnd)).toBeNull();
  });
});
