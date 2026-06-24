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
