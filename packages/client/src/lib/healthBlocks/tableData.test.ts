import type { HealthRun } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { buildMetricTableRows, buildRunTableRows } from "./tableData.js";

function run(id: string, date: string, distanceKm: number, durationSeconds: number): HealthRun {
  return {
    id,
    date,
    startTime: "07:00",
    distanceKm,
    durationSeconds,
    averageHeartRate: null,
    averageCadence: null,
    averageStrideM: null,
    averageVerticalRatioPercent: null,
    averageVerticalOscillationCm: null,
    averageGroundContactMs: null,
    type: "",
    city: "",
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  };
}

describe("health block table data", () => {
  it("builds metric rows from chart series", () => {
    const rows = buildMetricTableRows({
      metricIds: ["hrv.value"],
      columnIds: ["date", "hrv.value", "hrv.value:rolling:7"],
      rollingWindows: [7],
      range: { mode: "all" },
      hideEmptyRows: false,
      maxRows: null,
      collections: { hrvs: [{ id: "h1", date: "2026-06-15", hrvMs: 55, createdAt: "2026-06-15T00:00:00.000Z", updatedAt: "2026-06-15T00:00:00.000Z" }] },
    });

    expect(rows.columns.map((column) => column.id)).toEqual(["date", "hrv.value", "hrv.value:rolling:7"]);
    expect(rows.rows[0].cells["hrv.value"].formatted).toBe("55 ms");
  });

  it("limits metric rows by maxRows after filtering", () => {
    const rows = buildMetricTableRows({
      metricIds: ["hrv.value"],
      columnIds: ["date", "hrv.value"],
      rollingWindows: [],
      range: { mode: "all" },
      hideEmptyRows: false,
      maxRows: 1,
      collections: {
        hrvs: [
          { id: "h1", date: "2026-06-14", hrvMs: 50, createdAt: "2026-06-14T00:00:00.000Z", updatedAt: "2026-06-14T00:00:00.000Z" },
          { id: "h2", date: "2026-06-15", hrvMs: 55, createdAt: "2026-06-15T00:00:00.000Z", updatedAt: "2026-06-15T00:00:00.000Z" },
        ],
      },
    });

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].id).toBe("2026-06-14");
  });

  it("builds run rows sorted newest first", () => {
    const rows = buildRunTableRows({
      runs: [run("r1", "2026-06-14", 5, 1500), run("r2", "2026-06-15", 10, 3300)],
      columnIds: ["date", "distanceKm", "pace"],
      range: { mode: "all" },
      maxRows: null,
    });

    expect(rows.rows.map((row) => row.id)).toEqual(["r2", "r1"]);
    expect(rows.rows[0].cells.pace.formatted).toBe("5'30\"/km");
  });
});
