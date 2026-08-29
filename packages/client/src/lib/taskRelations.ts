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

/** 把关系边折成「谁被谁挡着」的索引，只收**未完成且仍然存在**的 blocker。
 *  `completedKeys` 与 `liveKeys` 都由调用方给出（`kind:id` 集合），口径须同源。 */
export function buildBlockedByIndex(
  relations: TaskRelation[],
  completedKeys: Set<string>,
  /**
   * 还活着的端点键（`task:<id>` / `track:<id>`）。**必传**：给默认全集会让「忘了传」
   * 静默退回旧口径，而旧口径正是这次要修的东西。
   *
   * 悬空 blocker（指向已删任务/轨道的边）既不完成也不存在，不筛掉的话它会永远挡着——
   * 被挡的那条活从「今天」区消失、卡在「在等」区显示「等（已删除）」，只能手动删边才解得开。
   * 这类边来自混合版本同步：老客户端删任务只推 tasks/delete，不知道关系表存在。
   * 边不删——详情面板照样列得出来，用户看得见、删得掉；这里只是不让它挡人。
   */
  liveKeys: Set<string>,
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const relation of relations) {
    const blockerKey = `${relation.blockerKind}:${relation.blockerId}`;
    if (completedKeys.has(blockerKey)) continue; // 前置已完成 → 不再挡，自动解锁
    if (!liveKeys.has(blockerKey)) continue; // 前置已不存在（悬空边）→ 不再挡
    const blockedKey = `${relation.blockedKind}:${relation.blockedId}`;
    index.set(blockedKey, [...(index.get(blockedKey) ?? []), blockerKey]);
  }
  return index;
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

/** 在调用方事务内，删掉「两端都在 memberKeys 内、且一端是 ref」的边（成员被移出目标时用）。
 *  调用方事务必须已含 db.taskRelations + db.syncLog。 */
export async function removeTaskRelationsWithinScopeInCurrentTransaction(
  memberKeys: Set<string>, // 目标全部成员的 `${kind}:${id}`
  ref: TaskRelationEnd,
  /** 发起清边的目标 id——它自己不算「别的目标」，否则一条边永远删不掉。 */
  excludeGoalId: string,
  now?: Date,
): Promise<void> {
  const timestamp = nowIso(now);
  const refKey = endKey(ref);
  // 一条边全局一行：同一对端点同时是两个目标的成员时，两边共用这一行（迁移专门做过这个去重，
  // 是支持的存量形态）。旧模型下 A、B 各持一份副本，删 A 的不影响 B；换成全局一行后，只按
  // 「两端都在本目标内」判就会连坐——从 A 移出成员，B 的星图箭头无声消失、零提示。
  // 故删之前先看这条边是否还落在别的目标的成员范围内，落着就留下。
  const otherScopes = (await db.goals.toArray())
    .filter((goal) => goal.id !== excludeGoalId)
    .map((goal) => new Set((goal.members ?? []).map((member) => `${member.kind}:${member.id}`)));
  const rows = await db.taskRelations.toArray();
  for (const row of rows) {
    const blockerKey = endKey({ kind: row.blockerKind, id: row.blockerId });
    const blockedKey = endKey({ kind: row.blockedKind, id: row.blockedId });
    const bothInScope = memberKeys.has(blockerKey) && memberKeys.has(blockedKey);
    if (!bothInScope) continue;
    const touchesRef = blockerKey === refKey || blockedKey === refKey;
    if (!touchesRef) continue;
    // 别的目标只包含一端时不算——那个目标的图上本来就没有这条边，删掉不影响它。
    const stillScopedElsewhere = otherScopes.some((scope) => scope.has(blockerKey) && scope.has(blockedKey));
    if (stillScopedElsewhere) continue;
    await db.taskRelations.delete([row.blockerKind, row.blockerId, row.blockedKind, row.blockedId]);
    await recordSyncLog("task_relations", taskRelationKey(row), "delete", timestamp);
  }
}
