import { describe, expect, it } from "vitest";
import { hitTestGoalStar, type GoalStarHitTarget } from "./goalStarHitTest.js";

function star(input: Partial<GoalStarHitTarget> & Pick<GoalStarHitTarget, "goalId" | "center">): GoalStarHitTarget {
  return {
    goalId: input.goalId,
    center: input.center,
    width: 80,
    height: 60,
    ...input,
  };
}

describe("hitTestGoalStar", () => {
  it("returns the goal id when the flow position is inside a centered star box", () => {
    expect(hitTestGoalStar({ x: 110, y: 105 }, [star({ goalId: "g1", center: { x: 100, y: 100 } })])).toBe("g1");
  });

  it("returns null when the flow position is outside all star boxes", () => {
    expect(hitTestGoalStar({ x: 141, y: 100 }, [star({ goalId: "g1", center: { x: 100, y: 100 } })])).toBeNull();
  });

  it("chooses the nearest center when multiple star boxes contain the point", () => {
    const result = hitTestGoalStar(
      { x: 30, y: 0 },
      [
        star({ goalId: "left", center: { x: 0, y: 0 }, width: 100, height: 100 }),
        star({ goalId: "right", center: { x: 40, y: 0 }, width: 100, height: 100 }),
      ],
    );

    expect(result).toBe("right");
  });

  it("skips stars that do not have usable measured dimensions", () => {
    expect(
      hitTestGoalStar(
        { x: 0, y: 0 },
        [
          star({ goalId: "missing-width", center: { x: 0, y: 0 }, width: 0 }),
          star({ goalId: "valid", center: { x: 10, y: 0 }, width: 80, height: 60 }),
        ],
      ),
    ).toBe("valid");
  });
});
