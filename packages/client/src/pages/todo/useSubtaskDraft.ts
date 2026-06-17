import { useEffect, useRef, useState } from "react";
import type { TaskSubtask } from "@timedata/shared";
import { subtasksDifferStructurally, trimSubtasks } from "../../lib/tasks/subtasks.js";

export interface UseSubtaskDraft {
  subtasks: TaskSubtask[];
  onChange: (next: TaskSubtask[]) => void;
  onBlur: () => void;
}

function serializeSubtasks(items: TaskSubtask[]): string {
  return JSON.stringify(trimSubtasks(items));
}

/**
 * 子任务草稿层：列表行与抽屉共用。
 * 只按 taskId 重新播种，避免同一任务的同步刷新覆盖正在输入的 draft。
 */
export function useSubtaskDraft({
  taskId,
  externalSubtasks,
  onCommit,
}: {
  taskId: string;
  externalSubtasks: TaskSubtask[];
  onCommit: (next: TaskSubtask[]) => void;
}): UseSubtaskDraft {
  const [draft, setDraft] = useState<TaskSubtask[]>(externalSubtasks);
  const draftRef = useRef(draft);
  const externalRef = useRef(externalSubtasks);
  const taskIdRef = useRef(taskId);
  const commitRef = useRef(onCommit);
  const committedSnapshotRef = useRef(serializeSubtasks(externalSubtasks));

  draftRef.current = draft;
  externalRef.current = externalSubtasks;
  commitRef.current = onCommit;

  function commit(next: TaskSubtask[]): void {
    const trimmed = trimSubtasks(next);
    committedSnapshotRef.current = JSON.stringify(trimmed);
    commitRef.current(trimmed);
  }

  function flush(): void {
    const nextSnapshot = serializeSubtasks(draftRef.current);
    if (nextSnapshot !== committedSnapshotRef.current) {
      commit(draftRef.current);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅 taskId 变化时 flush 旧 draft 并播种新任务
  useEffect(() => {
    if (taskIdRef.current === taskId) return;
    flush();
    taskIdRef.current = taskId;
    setDraft(externalRef.current);
    draftRef.current = externalRef.current;
    committedSnapshotRef.current = serializeSubtasks(externalRef.current);
  }, [taskId]);

  useEffect(() => () => flush(), []);

  function onChange(next: TaskSubtask[]): void {
    const structural = subtasksDifferStructurally(draftRef.current, next);
    draftRef.current = next;
    setDraft(next);
    if (structural) commit(next);
  }

  return {
    subtasks: draft,
    onChange,
    onBlur: flush,
  };
}
