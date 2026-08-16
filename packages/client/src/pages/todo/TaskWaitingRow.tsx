import { Plus, X } from "@phosphor-icons/react";
import type { Task, TaskRelation, Track } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Icon } from "../../components/Icon.js";
import { db } from "../../db/index.js";
import {
  addTaskRelation,
  listRelationsBlocking,
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
  const [error, setError] = useState<string | null>(null);

  const data = useLiveQuery(
    async () => {
      const [relations, tasks, tracks] = await Promise.all([
        listRelationsBlocking({ kind: "task", id: taskId }),
        db.tasks.toArray(),
        db.tracks.toArray(),
      ]);
      return { relations, tasks, tracks };
    },
    [taskId],
  );
  const relations = data?.relations ?? [];
  const tasks = data?.tasks ?? [];
  const tracks = data?.tracks ?? [];

  const titleByKey = new Map<string, string>();
  for (const task of tasks) titleByKey.set(`task:${task.id}`, task.title);
  for (const track of tracks) titleByKey.set(`track:${track.id}`, track.title);

  const blockers = relations.map((relation) => {
    const end = relationEnd(relation);
    return { key: endKey(end), end, title: titleByKey.get(endKey(end)) ?? "（已删除）" };
  });
  const existingBlockerKeys = new Set(blockers.map((blocker) => blocker.key));
  const taskCandidates = tasks
    .filter((task) => !task.done && task.id !== taskId && !existingBlockerKeys.has(`task:${task.id}`))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  const trackCandidates = tracks
    .filter((track) => track.status === "active" && !existingBlockerKeys.has(`track:${track.id}`))
    .sort((a, b) => a.title.localeCompare(b.title));

  function errorMessage(err: unknown, attempted: TaskRelationEnd): string {
    const reason = err instanceof Error ? err.message : "";
    if (reason === "RELATION_SELF_REFERENCE") return "不能连接自己";
    if (reason === "RELATION_WOULD_CREATE_CYCLE") {
      const blame = cycleBlameTitle(`task:${taskId}`, endKey(attempted), relations, titleByKey);
      return `这样会绕成圈：${blame} 已经在等这条了`;
    }
    return "添加前置失败，请重试";
  }

  async function addBlocker(end: TaskRelationEnd): Promise<void> {
    try {
      await addTaskRelation({ blocker: end, blocked: { kind: "task", id: taskId } });
      setError(null);
      setPickerOpen(false);
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
            setPickerOpen((open) => !open);
          }}
          className="inline-flex min-h-8 items-center gap-1 rounded-ctl px-2 td-text-caption text-ink-3 hover:bg-surface-hover hover:text-accent"
        >
          <Icon icon={Plus} size={14} />
          添加
        </button>
      </div>

      {error && <p className="td-text-caption text-danger">{error}</p>}

      {blockers.length > 0 && (
        <ul className="space-y-1">
          {blockers.map((blocker) => (
            <li
              key={blocker.key}
              data-testid="task-waiting-blocker"
              className="flex min-h-8 items-center gap-2 rounded-row border border-border-hairline bg-surface-elevated px-2"
            >
              <span className="min-w-0 flex-1 truncate td-text-body text-ink">{blocker.title}</span>
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

      {pickerOpen &&
        (taskCandidates.length === 0 && trackCandidates.length === 0 ? (
          <p className="rounded-row border border-dashed border-border-hairline px-3 py-3 td-text-body text-ink-3">
            没有可添加的前置
          </p>
        ) : (
          <div className="space-y-2">
            {taskCandidates.length > 0 && (
              <div className="space-y-1">
                <p className="px-1 td-text-caption text-ink-3">任务</p>
                {taskCandidates.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    aria-label={`添加前置 ${task.title}`}
                    onClick={() => void addBlocker({ kind: "task", id: task.id })}
                    className="flex min-h-9 w-full items-center rounded-row border border-border bg-surface-elevated px-2 td-text-body text-ink hover:bg-surface-hover"
                  >
                    <span className="min-w-0 flex-1 truncate text-left">{task.title}</span>
                  </button>
                ))}
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
        ))}
    </section>
  );
}
