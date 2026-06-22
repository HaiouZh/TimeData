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

// 旧 OR 过滤，本期暂留（Task 6 退役）。新调用点请用 filterTasks。
export function filterByTags(tasks: Task[], selected: string[]): Task[] {
  if (selected.length === 0) return tasks;
  const set = new Set(selected);
  return tasks.filter((t) => (t.tags ?? []).some((tag) => set.has(tag)));
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

const TAG_PALETTE = [
  "#2F4858",
  "#33636C",
  "#3D5A80",
  "#4C5C68",
  "#3A5743",
  "#48506B",
  "#5A4E6D",
  "#2C5F60",
  "#445A7A",
  "#54667A",
  "#3E6259",
  "#615A77",
] as const;

/** 标签名 → 稳定颜色（FNV-1a hash 取模色板，确定性、不存储）。 */
export function tagColor(tag: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return TAG_PALETTE[(h >>> 0) % TAG_PALETTE.length];
}
