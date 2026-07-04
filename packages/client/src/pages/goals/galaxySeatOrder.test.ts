import type { Goal } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { seatOrderedActiveGoals } from "./galaxySeatOrder.js";

function goal(id: string, createdAt: string, overrides: Partial<Goal> = {}): Goal {
  return {
    id,
    title: `目标${id}`,
    note: "",
    kind: "project",
    status: "active",
    members: [],
    prerequisites: [],
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  } as Goal;
}

describe("seatOrderedActiveGoals", () => {
  it("按 createdAt 升序、同刻按 id 兜底", () => {
    const goals = [
      goal("b", "2026-01-02T00:00:00.000Z"),
      goal("c", "2026-01-01T00:00:00.000Z"),
      goal("a", "2026-01-01T00:00:00.000Z"),
    ];

    expect(seatOrderedActiveGoals(goals).map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  it("编辑（updatedAt 变化）不改变席位序", () => {
    const base = [goal("a", "2026-01-01T00:00:00.000Z"), goal("b", "2026-01-02T00:00:00.000Z")];
    const edited = [{ ...base[0], updatedAt: "2026-06-30T00:00:00.000Z" }, base[1]];

    expect(seatOrderedActiveGoals(edited).map((item) => item.id)).toEqual(
      seatOrderedActiveGoals(base).map((item) => item.id),
    );
  });

  it("过滤非 active，且不改动传入数组", () => {
    const goals = [
      goal("z", "2026-01-03T00:00:00.000Z"),
      goal("x", "2026-01-01T00:00:00.000Z", { status: "archived" }),
    ];

    const result = seatOrderedActiveGoals(goals);

    expect(result.map((item) => item.id)).toEqual(["z"]);
    expect(goals[0].id).toBe("z");
  });
});
