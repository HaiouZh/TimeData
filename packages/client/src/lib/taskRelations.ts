import { TaskRelationSchema, taskRelationKey, type TaskRelation } from "@timedata/shared";
import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";

export interface TaskRelationEnd {
  kind: "task" | "track";
  id: string;
}

export interface TaskRelationInput {
  blocker: TaskRelationEnd;
  blocked: TaskRelationEnd;
  now?: Date;
}

function endKey(end: TaskRelationEnd): string {
  return `${end.kind}:${end.id}`;
}

function keyTuple(input: { blocker: TaskRelationEnd; blocked: TaskRelationEnd }): [string, string, string, string] {
  return [input.blocker.kind, input.blocker.id, input.blocked.kind, input.blocked.id];
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

export async function listTaskRelations(): Promise<TaskRelation[]> {
  const rows = await db.taskRelations.toArray();
  return rows.flatMap((row) => {
    const parsed = TaskRelationSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/** 「谁在挡我」——返回 blocked 端等于 ref 的全部边。 */
export async function listRelationsBlocking(ref: TaskRelationEnd): Promise<TaskRelation[]> {
  const all = await listTaskRelations();
  return all.filter((relation) => endKey({ kind: relation.blockedKind, id: relation.blockedId }) === endKey(ref));
}

/**
 * 加上 blocker→blocked 这条边会不会成环。
 *
 * 从 blocked 出发沿 blocker→blocked 方向走，若能走回 blocker，说明加了就成环。
 * 自反（blocker === blocked）直接算环。
 */
export function wouldCreateCycle(
  relations: TaskRelation[],
  blocker: TaskRelationEnd,
  blocked: TaskRelationEnd,
): boolean {
  const from = endKey(blocker);
  const to = endKey(blocked);
  if (from === to) return true;

  const next = new Map<string, string[]>();
  for (const relation of relations) {
    const a = endKey({ kind: relation.blockerKind, id: relation.blockerId });
    const b = endKey({ kind: relation.blockedKind, id: relation.blockedId });
    next.set(a, [...(next.get(a) ?? []), b]);
  }

  const seen = new Set<string>();
  const stack = [to];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node === from) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    stack.push(...(next.get(node) ?? []));
  }
  return false;
}

export async function addTaskRelation(input: TaskRelationInput): Promise<TaskRelation> {
  if (endKey(input.blocker) === endKey(input.blocked)) {
    throw new Error("RELATION_SELF_REFERENCE");
  }

  const timestamp = nowIso(input.now);
  let created: TaskRelation | null = null;

  await db.transaction("rw", db.taskRelations, db.syncLog, async () => {
    const existing = await db.taskRelations.get(keyTuple(input));
    if (existing) {
      const parsed = TaskRelationSchema.safeParse(existing);
      created = parsed.success ? parsed.data : null;
      return;
    }

    const all = await listTaskRelations();
    if (wouldCreateCycle(all, input.blocker, input.blocked)) {
      throw new Error("RELATION_WOULD_CREATE_CYCLE");
    }

    const relation = TaskRelationSchema.parse({
      blockerKind: input.blocker.kind,
      blockerId: input.blocker.id,
      blockedKind: input.blocked.kind,
      blockedId: input.blocked.id,
      type: "blocks",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.taskRelations.put(relation);
    await recordSyncLog("task_relations", taskRelationKey(relation), "create", timestamp);
    created = relation;
  });

  if (!created) throw new Error("RELATION_WRITE_FAILED");
  return created;
}

export async function removeTaskRelation(input: TaskRelationInput): Promise<void> {
  const timestamp = nowIso(input.now);

  await db.transaction("rw", db.taskRelations, db.syncLog, async () => {
    const existing = await db.taskRelations.get(keyTuple(input));
    if (!existing) return;
    await db.taskRelations.delete(keyTuple(input));
    await recordSyncLog(
      "task_relations",
      taskRelationKey({
        blockerKind: input.blocker.kind,
        blockerId: input.blocker.id,
        blockedKind: input.blocked.kind,
        blockedId: input.blocked.id,
      }),
      "delete",
      timestamp,
    );
  });
}

/** 在调用方事务内删除某一端参与的全部边（任务/轨道被删时连带清理）。
 *  调用方事务必须已含 db.taskRelations + db.syncLog。 */
export async function removeTaskRelationsForInCurrentTransaction(
  ref: TaskRelationEnd,
  now?: Date,
): Promise<void> {
  const timestamp = nowIso(now);
  const rows = await db.taskRelations.toArray();
  for (const row of rows) {
    const isEnd =
      endKey({ kind: row.blockerKind, id: row.blockerId }) === endKey(ref) ||
      endKey({ kind: row.blockedKind, id: row.blockedId }) === endKey(ref);
    if (!isEnd) continue;
    await db.taskRelations.delete([row.blockerKind, row.blockerId, row.blockedKind, row.blockedId]);
    await recordSyncLog("task_relations", taskRelationKey(row), "delete", timestamp);
  }
}
