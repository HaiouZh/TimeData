import type { Task } from "@timedata/shared";
import { matchesAllTerms, parseSearchTerms } from "../../quick-notes/searchTerms.js";

export function allTags(tasks: Task[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    for (const tag of t.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}

export interface TaskFilter {
  searchQuery: string;
  includeTags: string[];
  excludeTags: string[];
  tagMode: "and" | "or";
}

/** 三轴 AND 叠加（含 ∧ 排除 ∧ 关键词），空轴跳过，无短路。 */
export function filterTasks(tasks: Task[], f: TaskFilter): Task[] {
  const exclude = new Set(f.excludeTags);
  const terms = parseSearchTerms(f.searchQuery);
  return tasks.filter((t) => {
    const tags = t.tags ?? [];
    if (f.includeTags.length > 0) {
      const tagSet = new Set(tags);
      const ok =
        f.tagMode === "and"
          ? f.includeTags.every((tag) => tagSet.has(tag))
          : f.includeTags.some((tag) => tagSet.has(tag));
      if (!ok) return false;
    }
    if (exclude.size > 0 && tags.some((tag) => exclude.has(tag))) return false;
    if (terms.length > 0 && !matchesAllTerms(t.title.toLowerCase(), terms)) return false;
    return true;
  });
}
