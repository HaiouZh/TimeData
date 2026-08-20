import { Plus, X } from "@phosphor-icons/react";
import type { TaskRelation } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { db } from "../../db/index.js";
import { blockerCandidateContext, filterBlockerCandidates } from "../../lib/tasks/blockerCandidates.js";
import {
  addTaskRelation,
  listRelationsBlocking,
  listTaskRelations,
  removeTaskRelation,
  type TaskRelationEnd,
} from "../../lib/taskRelations.js";

function endKey(end: TaskRelationEnd): string {
  return `${end.kind}:${end.id}`;
}

function relationEnd(relation: TaskRelation): TaskRelationEnd {
  return { kind: relation.blockerKind, id: relation.blockerId };
}

/**
 * 成环时报「哪一条造成的环」：沿 blocker→blocked 方向从本任务走到候选目标，
 * 路径上紧挨本任务的那一方就是「已经在等这条了」的既有关系当事人（直接场景下它正是候选本身）。
 *
 * **`relations` 必须是全量边，不能喂 `listRelationsBlocking` 的结果**——那个函数只返回
 * 「blocked 端 = 本任务」的**入**边，而这里的遍历要走的是「本任务挡着谁」的**出**边，方向正好相反。
 * 喂入边时 `next` 里根本没有 `taskKey` 这个 key（自反边被 schema 拒），BFS 一步都走不出去，
 * 函数恒返回「（已删除）」——终审三条镜头独立抓到过这个形态，测试当时是假绿（断言里那个标题
 * 由仍开着的候选按钮满足，从没断言过错误文案本身）。
 */
function cycleBlameTitle(
  taskKey: string,
  targetKey: string,
  relations: TaskRelation[],
  titleByKey: Map<string, string>,
): string {
  const next = new Map<string, string[]>();
  for (const relation of relations) {
    const a = `${relation.blockerKind}:${relation.blockerId}`;
    const b = `${relation.blockedKind}:${relation.blockedId}`;
    next.set(a, [...(next.get(a) ?? []), b]);
  }
  const queue = [taskKey];
  const seen = new Set([taskKey]);
  const firstHop = new Map<string, string>();
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    for (const neighbor of next.get(node) ?? []) {
      if (seen.has(neighbor)) continue;
      seen.add(neighbor);
      firstHop.set(neighbor, node === taskKey ? neighbor : firstHop.get(node) ?? neighbor);
      if (neighbor === targetKey) return titleByKey.get(firstHop.get(neighbor) ?? neighbor) ?? "（已删除）";
      queue.push(neighbor);
    }
  }
  return "（已删除）";
}

export interface TaskWaitingRowProps {
  taskId: string;
}

/**
 * 任务详情里的「在等」行：列出挡着这条任务的前置（任务/轨道），可加可删。
 * 候选 = 未完成的任务与 active 轨道，排除自己与已是前置的（未完成口径与 listTasks 的 completedKeys 一致）。
 */
export function TaskWaitingRow({ taskId }: TaskWaitingRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const data = useLiveQuery(
    async () => {
      // allRelations 供成环归因用（要出边，见 cycleBlameTitle 的注释）；relations 只是它按
      // 「blocked 端 = 本任务」筛出的入边，供本行列表用。两者口径不同，别合并成一个。
      const [relations, allRelations, tasks, tracks, goals] = await Promise.all([
        listRelationsBlocking({ kind: "task", id: taskId }),
        listTaskRelations(),
        db.tasks.toArray(),
        db.tracks.toArray(),
        db.goals.toArray(),
      ]);
      return { relations, allRelations, tasks, tracks, goals };
    },
    [taskId],
  );
  const relations = data?.relations ?? [];
  const allRelations = data?.allRelations ?? [];
  const tasks = data?.tasks ?? [];
  const tracks = data?.tracks ?? [];
  const goals = data?.goals ?? [];

  const titleByKey = new Map<string, string>();
  const completedKeys = new Set<string>();
  for (const task of tasks) {
    titleByKey.set(`task:${task.id}`, task.title);
    if (task.done) completedKeys.add(`task:${task.id}`);
  }
  for (const track of tracks) {
    titleByKey.set(`track:${track.id}`, track.title);
    if (track.status !== "active") completedKeys.add(`track:${track.id}`);
  }

  // 已完成的前置不再挡着——判据与 listTasks 的 completedKeys 同源（buildBlockedByIndex 直接跳过它们）。
  // 这里不把边过滤掉而是标出来：边还在，用户得看得见才删得掉；但不标的话，待办页已经把这条活解锁了、
  // 详情面板却仍写着「在等 XX」，同一条任务在两个地方显示相反的状态。
  const blockers = relations.map((relation) => {
    const end = relationEnd(relation);
    const key = endKey(end);
    return { key, end, title: titleByKey.get(key) ?? "（已删除）", satisfied: completedKeys.has(key) };
  });
  const existingBlockerKeys = new Set(blockers.map((blocker) => blocker.key));

  const projectNameByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    for (const goal of goals) {
      const raw = goal as unknown as {
        status?: string;
        kind?: string;
        title?: string;
        members?: Array<{ kind?: string; id?: string }>;
      };
      if (raw.status !== "active" || raw.kind !== "project") continue;
      if (!Array.isArray(raw.members)) continue;
      const title = raw.title ?? "";
      for (const member of raw.members) {
        if (member?.kind !== "task" || typeof member.id !== "string" || member.id === "") continue;
        map.set(member.id, title);
      }
    }
    return map;
  }, [goals]);

  const taskTitleById = useMemo(() => new Map(tasks.map((t) => [t.id, t.title])), [tasks]);

  const { tasks: taskCandidates, tracks: trackCandidates } = filterBlockerCandidates({
    tasks,
    tracks,
    selfTaskId: taskId,
    existingBlockerKeys,
    query,
  });

  function errorMessage(err: unknown, attempted: TaskRelationEnd): string {
    const reason = err instanceof Error ? err.message : "";
    if (reason === "RELATION_SELF_REFERENCE") return "不能连接自己";
    if (reason === "RELATION_WOULD_CREATE_CYCLE") {
      const blame = cycleBlameTitle(`task:${taskId}`, endKey(attempted), allRelations, titleByKey);
      return `这样会绕成圈：${blame} 已经在等这条了`;
    }
    return "添加前置失败，请重试";
  }

  async function addBlocker(end: TaskRelationEnd): Promise<void> {
    try {
      await addTaskRelation({ blocker: end, blocked: { kind: "task", id: taskId } });
      setError(null);
      setPickerOpen(false);
      setQuery("");
    } catch (err) {
      setError(errorMessage(err, end));
    }
  }

  async function removeBlocker(end: TaskRelationEnd): Promise<void> {
    try {
      await removeTaskRelation({ blocker: end, blocked: { kind: "task", id: taskId } });
      setError(null);
    } catch {
      setError("移除前置失败，请重试");
    }
  }

  return (
    <section data-testid="task-waiting-row" className="space-y-2 rounded-ctl border border-border-hairline bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="td-text-label text-ink-2">在等</h3>
        <button
          type="button"
          aria-label="添加前置"
          aria-expanded={pickerOpen}
          onClick={() => {
            setError(null);
            setPickerOpen((open) => {
              if (open) setQuery("");
              return !open;
            });
          }}
          className="inline-flex min-h-8 items-center gap-1 rounded-ctl px-2 td-text-caption text-ink-3 hover:bg-surface-hover hover:text-accent"
        >
          <Icon icon={Plus} size={14} />
          添加
        </button>
      </div>

      {error && (
        <p data-testid="task-waiting-error" className="td-text-caption text-danger">
          {error}
        </p>
      )}

      {blockers.length > 0 && (
        <ul className="space-y-1">
          {blockers.map((blocker) => (
            <li
              key={blocker.key}
              data-testid="task-waiting-blocker"
              className="flex min-h-8 items-center gap-2 rounded-row border border-border-hairline bg-surface-elevated px-2"
            >
              <span
                className={`min-w-0 flex-1 truncate td-text-body ${blocker.satisfied ? "text-ink-3 line-through" : "text-ink"}`}
              >
                {blocker.title}
              </span>
              {blocker.satisfied && <span className="shrink-0 td-text-caption text-ink-3">已完成</span>}
              <button
                type="button"
                aria-label={`移除前置 ${blocker.title}`}
                onClick={() => void removeBlocker(blocker.end)}
                className="shrink-0 text-ink-3 hover:text-danger"
              >
                <Icon icon={X} size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!pickerOpen && blockers.length === 0 && <p className="td-text-caption text-ink-3">没有前置</p>}

      {pickerOpen && (
        <div className="space-y-2">
          <input
            aria-label="搜索前置候选"
            placeholder="搜索…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            autoFocus
            className="w-full rounded-ctl border border-border bg-surface px-2 py-1 text-ink outline-none placeholder:text-ink-3 focus:border-accent"
          />
          {taskCandidates.length === 0 && trackCandidates.length === 0 ? (
            <p className="rounded-row border border-dashed border-border-hairline px-3 py-3 td-text-body text-ink-3">
              没有可添加的前置
            </p>
          ) : (
            <div className="space-y-2">
              {taskCandidates.length > 0 && (
                <div className="space-y-1">
                  <p className="px-1 td-text-caption text-ink-3">任务</p>
                  {taskCandidates.map((task) => {
                    const context = blockerCandidateContext(task, { projectNameByTaskId, taskTitleById });
                    return (
                      <button
                        key={task.id}
                        type="button"
                        aria-label={`添加前置 ${task.title}`}
                        onClick={() => void addBlocker({ kind: "task", id: task.id })}
                        className="flex min-h-9 w-full items-center gap-2 rounded-row border border-border bg-surface-elevated px-2 td-text-body text-ink hover:bg-surface-hover"
                      >
                        <span className="min-w-0 flex-1 truncate text-left">{task.title}</span>
                        {context !== null && <span className="shrink-0 td-text-caption text-ink-3">{context}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {trackCandidates.length > 0 && (
                <div className="space-y-1">
                  <p className="px-1 td-text-caption text-ink-3">轨道</p>
                  {trackCandidates.map((track) => (
                    <button
                      key={track.id}
                      type="button"
                      aria-label={`添加前置 ${track.title}`}
                      onClick={() => void addBlocker({ kind: "track", id: track.id })}
                      className="flex min-h-9 w-full items-center rounded-row border border-border bg-surface-elevated px-2 td-text-body text-ink hover:bg-surface-hover"
                    >
                      <span className="min-w-0 flex-1 truncate text-left">{track.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
