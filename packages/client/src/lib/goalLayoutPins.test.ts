import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import {
  deleteGoalLayoutPin,
  getGoalLayoutPin,
  listAllGoalLayoutPins,
  listGoalLayoutPins,
  upsertGoalLayoutPin,
} from "./goalLayoutPins.js";

const now = new Date("2026-06-24T00:00:00.000Z");

beforeEach(resetDb);

afterEach(resetDb);

describe("goalLayoutPins", () => {
  it("upserts pins by compound key and records sync logs", async () => {
    await upsertGoalLayoutPin({ goalId: "goal-1", nodeKind: "goal", nodeId: "goal-1", x: 10, y: 20, now });
    await upsertGoalLayoutPin({ goalId: "goal-1", nodeKind: "goal", nodeId: "goal-1", x: 12, y: 24, now });

    await expect(listGoalLayoutPins("goal-1")).resolves.toEqual([
      {
        goalId: "goal-1",
        nodeKind: "goal",
        nodeId: "goal-1",
        x: 12,
        y: 24,
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    ]);
    expect(await db.syncLog.where("tableName").equals("goal_layout_pins").count()).toBe(2);
    await expect(db.syncLog.toArray()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordId: "goal-1|goal|goal-1", action: "create" }),
        expect.objectContaining({ recordId: "goal-1|goal|goal-1", action: "update" }),
      ]),
    );
  });

  it("deletes a pin and records a delete log", async () => {
    await upsertGoalLayoutPin({ goalId: "goal-1", nodeKind: "task", nodeId: "task-1", x: 1, y: 2, now });
    await deleteGoalLayoutPin({ goalId: "goal-1", nodeKind: "task", nodeId: "task-1", now });

    await expect(getGoalLayoutPin({ goalId: "goal-1", nodeKind: "task", nodeId: "task-1" })).resolves.toBeUndefined();
    await expect(db.syncLog.toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ recordId: "goal-1|task|task-1", action: "delete" })]),
    );
  });

  it("listAllGoalLayoutPins returns pins from every goal", async () => {
    await upsertGoalLayoutPin({ goalId: "g1", nodeKind: "goal", nodeId: "g1", x: 1, y: 2, now });
    await upsertGoalLayoutPin({ goalId: "g2", nodeKind: "task", nodeId: "t1", x: 3, y: 4, now });

    const all = await listAllGoalLayoutPins();

    expect(all.map((pin) => `${pin.goalId}:${pin.nodeKind}:${pin.nodeId}`).sort()).toEqual([
      "g1:goal:g1",
      "g2:task:t1",
    ]);
  });
});
