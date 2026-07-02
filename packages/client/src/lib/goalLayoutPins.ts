import {
  GoalLayoutPinSchema,
  goalLayoutPinKey,
  type GoalLayoutPin,
  type GoalLayoutPinNodeKind,
} from "@timedata/shared";
import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";

export interface GoalLayoutPinRef {
  goalId: string;
  nodeKind: GoalLayoutPinNodeKind;
  nodeId: string;
}

export interface UpsertGoalLayoutPinInput extends GoalLayoutPinRef {
  x: number;
  y: number;
  now?: Date;
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function keyTuple(ref: GoalLayoutPinRef): [string, GoalLayoutPinNodeKind, string] {
  return [ref.goalId, ref.nodeKind, ref.nodeId];
}

export async function getGoalLayoutPin(ref: GoalLayoutPinRef): Promise<GoalLayoutPin | undefined> {
  const row = await db.goalLayoutPins.get(keyTuple(ref));
  const parsed = GoalLayoutPinSchema.safeParse(row);
  return parsed.success ? parsed.data : undefined;
}

export async function listGoalLayoutPins(goalId: string): Promise<GoalLayoutPin[]> {
  const rows = await db.goalLayoutPins.where("goalId").equals(goalId).toArray();
  return rows.flatMap((row) => {
    const parsed = GoalLayoutPinSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function listAllGoalLayoutPins(): Promise<GoalLayoutPin[]> {
  const rows = await db.goalLayoutPins.toArray();
  return rows.flatMap((row) => {
    const parsed = GoalLayoutPinSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function upsertGoalLayoutPin(input: UpsertGoalLayoutPinInput): Promise<GoalLayoutPin> {
  const timestamp = nowIso(input.now);
  const pin = GoalLayoutPinSchema.parse({
    goalId: input.goalId,
    nodeKind: input.nodeKind,
    nodeId: input.nodeId,
    x: input.x,
    y: input.y,
    updatedAt: timestamp,
  });
  const recordId = goalLayoutPinKey(pin);

  await db.transaction("rw", db.goalLayoutPins, db.syncLog, async () => {
    const existing = await db.goalLayoutPins.get(keyTuple(pin));
    await db.goalLayoutPins.put(pin);
    await recordSyncLog("goal_layout_pins", recordId, existing ? "update" : "create", timestamp);
  });

  return pin;
}

export async function deleteGoalLayoutPin(input: GoalLayoutPinRef & { now?: Date }): Promise<void> {
  const timestamp = nowIso(input.now);
  const recordId = goalLayoutPinKey(input);

  await db.transaction("rw", db.goalLayoutPins, db.syncLog, async () => {
    await db.goalLayoutPins.delete(keyTuple(input));
    await recordSyncLog("goal_layout_pins", recordId, "delete", timestamp);
  });
}

/** 在调用方事务内删除某 Goal 名下全部布局钉点（world + 成员），逐条记 delete syncLog。
 *  调用方事务必须已含 db.goalLayoutPins + db.syncLog。 */
export async function deleteGoalLayoutPinsForGoalInCurrentTransaction(goalId: string, now?: Date): Promise<void> {
  const timestamp = nowIso(now);
  const rows = await db.goalLayoutPins.where("goalId").equals(goalId).toArray();
  for (const row of rows) {
    await db.goalLayoutPins.delete([row.goalId, row.nodeKind, row.nodeId]);
    await recordSyncLog("goal_layout_pins", goalLayoutPinKey(row), "delete", timestamp);
  }
}

/** 在调用方事务内删除单个成员在某 Goal 下的布局钉点（不存在则 no-op）。 */
export async function deleteGoalMemberPinInCurrentTransaction(ref: GoalLayoutPinRef, now?: Date): Promise<void> {
  const timestamp = nowIso(now);
  const existing = await db.goalLayoutPins.get(keyTuple(ref));
  if (!existing) return;
  await db.goalLayoutPins.delete(keyTuple(ref));
  await recordSyncLog("goal_layout_pins", goalLayoutPinKey(ref), "delete", timestamp);
}
