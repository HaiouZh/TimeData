import type { Task, Track } from "@timedata/shared";

function matchesQuery(title: string, query: string): boolean {
  const trimmed = query.trim();
  if (trimmed === "") return true;
  return title.toLowerCase().includes(trimmed.toLowerCase());
}

export function filterBlockerCandidates(args: {
  tasks: readonly Task[];
  tracks: readonly Track[];
  selfTaskId: string;
  existingBlockerKeys: ReadonlySet<string>;
  query: string;
}): { tasks: Task[]; tracks: Track[] } {
  const tasks = args.tasks
    .filter(
      (task) =>
        !task.done &&
        task.id !== args.selfTaskId &&
        !args.existingBlockerKeys.has(`task:${task.id}`) &&
        (task.ruleId ?? null) === null &&
        (task.recurrence ?? null) === null &&
        matchesQuery(task.title, args.query),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const tracks = args.tracks.filter(
    (track) =>
      track.status === "active" &&
      !args.existingBlockerKeys.has(`track:${track.id}`) &&
      matchesQuery(track.title, args.query),
  );

  return { tasks, tracks };
}

export function blockerCandidateContext(
  task: Task,
  ctx: {
    projectNameByTaskId: ReadonlyMap<string, string>;
    taskTitleById: ReadonlyMap<string, string>;
  },
): string | null {
  const projectName = ctx.projectNameByTaskId.get(task.id);
  if (projectName !== undefined) return projectName;
  if (task.parentId !== null) {
    const parentTitle = ctx.taskTitleById.get(task.parentId);
    if (parentTitle !== undefined) return parentTitle;
  }
  if (task.scheduledAt !== null) {
    const d = new Date(task.scheduledAt);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return null;
}
