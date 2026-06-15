import { describe, expect, it } from "vitest";
import { tableToCsv } from "./csv.js";

describe("tableToCsv", () => {
  it("exports selected columns with escaped text", () => {
    const csv = tableToCsv({
      columns: [{ id: "date", label: "日期" }, { id: "note", label: "备注" }],
      rows: [{ id: "1", cells: { date: { formatted: "2026-06-15" }, note: { formatted: "A,B" } } }],
    });

    expect(csv).toBe("\uFEFF日期,备注\n2026-06-15,\"A,B\"");
  });
});
