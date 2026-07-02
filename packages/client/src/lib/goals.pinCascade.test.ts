import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import { addGoal, addGoalMember, deleteGoal, removeGoalMember } from "./goals.js";
import { getGoalLayoutPin, upsertGoalLayoutPin } from "./goalLayoutPins.js";

const now = "2026-07-02T01:00:00.000Z";

beforeEach(resetDb);
afterEach(resetDb);

async function seedTask(id: string, title: string): Promise<void> {
  await db.tasks.add({
    id,
    parentId: null,
    title,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  });
}

describe("goal layout pin cascade cleanup", () => {
  it("删除 Goal 同事务清掉它的 world pin 与成员 pin，并逐条记 delete syncLog", async () => {
    const goal = await addGoal({ title: "G", kind: "project", now: new Date(now) });
    await seedTask("task-1", "T");
    await addGoalMember(goal.id, { kind: "task", id: "task-1" });
    await upsertGoalLayoutPin({ goalId: goal.id, nodeKind: "goal", nodeId: goal.id, x: 10, y: 20 });
    await upsertGoalLayoutPin({ goalId: goal.id, nodeKind: "task", nodeId: "task-1", x: 3, y: 4 });

    await deleteGoal(goal.id);

    expect(await db.goalLayoutPins.where("goalId").equals(goal.id).count()).toBe(0);
    const pinDeletes = (await db.syncLog.toArray()).filter(
      (l) => l.tableName === "goal_layout_pins" && l.action === "delete",
    );
    expect(pinDeletes).toHaveLength(2);
  });

  it("移出成员清掉该成员在此 Goal 下的 pin，其它成员 pin 不动", async () => {
    const goal = await addGoal({ title: "G", kind: "project", now: new Date(now) });
    await seedTask("task-a", "A");
    await seedTask("task-b", "B");
    await addGoalMember(goal.id, { kind: "task", id: "task-a" });
    await addGoalMember(goal.id, { kind: "task", id: "task-b" });
    await upsertGoalLayoutPin({ goalId: goal.id, nodeKind: "task", nodeId: "task-a", x: 1, y: 1 });
    await upsertGoalLayoutPin({ goalId: goal.id, nodeKind: "task", nodeId: "task-b", x: 2, y: 2 });

    await removeGoalMember(goal.id, { kind: "task", id: "task-a" });

    expect(await getGoalLayoutPin({ goalId: goal.id, nodeKind: "task", nodeId: "task-a" })).toBeUndefined();
    expect(await getGoalLayoutPin({ goalId: goal.id, nodeKind: "task", nodeId: "task-b" })).toBeDefined();
  });
});
