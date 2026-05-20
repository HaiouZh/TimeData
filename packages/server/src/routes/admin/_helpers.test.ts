import { beforeEach, describe, expect, it, vi } from "vitest";

const prepare = vi.fn();

vi.mock("../../db/connection.js", () => ({
  getDb: () => ({ prepare }),
  getDbPath: () => ":memory:",
}));

const { getHealthCheck } = await import("./_helpers.js");

describe("getHealthCheck", () => {
  beforeEach(() => {
    prepare.mockReset();
  });

  it("counts all violating rows while returning at most five sample ids", () => {
    const sampleRows = Array.from({ length: 100 }, (_, index) => ({ id: `entry-${index + 1}` }));
    const countStatement = { get: vi.fn(() => ({ count: 100 })), all: vi.fn(() => sampleRows) };
    const sampleStatement = { all: vi.fn(() => sampleRows.slice(0, 5)) };
    prepare.mockReturnValueOnce(countStatement).mockReturnValueOnce(sampleStatement);

    const result = getHealthCheck("missing_category", "error", {
      countSql: "SELECT id FROM time_entries WHERE category_id = ?",
      sampleSql: "SELECT id FROM time_entries WHERE category_id = ? ORDER BY start_time, id",
      params: ["missing"],
    });

    expect(result).toEqual({
      code: "missing_category",
      severity: "error",
      count: 100,
      sampleIds: ["entry-1", "entry-2", "entry-3", "entry-4", "entry-5"],
    });
    expect(prepare).toHaveBeenNthCalledWith(1, "SELECT COUNT(*) AS count FROM (SELECT id FROM time_entries WHERE category_id = ?)");
    expect(prepare.mock.calls[0]?.[0]).not.toContain("ORDER BY");
    expect(prepare.mock.calls[1]?.[0]).toContain("ORDER BY start_time, id");
    expect(prepare).toHaveBeenNthCalledWith(
      2,
      "SELECT id FROM (SELECT id FROM time_entries WHERE category_id = ? ORDER BY start_time, id) LIMIT 5",
    );
    expect(countStatement.get).toHaveBeenCalledWith("missing");
    expect(sampleStatement.all).toHaveBeenCalledWith("missing");
  });
});
