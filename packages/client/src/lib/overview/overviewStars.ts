import type {
  OverviewStarKind,
  OverviewStatusEvent,
  QuickNote,
  Task,
  Track,
  TrackStep,
} from "@timedata/shared";
import { OVERVIEW_DONE_WINDOW_DAYS, isRuleExhausted, isWithinOverviewDays } from "@timedata/shared";
import { getDateString } from "../time.js";
import { trackActivityAt } from "../goalsView.js";

/** 星的数据来源。 */
export type OverviewStarSource =
  | { type: "quick_note"; note: QuickNote }
  | { type: "task"; task: Task }
  | { type: "track"; track: Track };

/** 全貌上的一颗星。 */
export interface OverviewStar {
  key: string;
  kind: OverviewStarKind;
  title: string;
  /** 已小写。 */
  searchText: string;
  /** 最近一次动静。 */
  at: string;
  /** 只有速记可能为 true。 */
  pinned: boolean;
  /** 去原处。 */
  href: string;
  source: OverviewStarSource;
  /** 并进这颗星的子任务的完成动静。 */
  extraEvents: OverviewStatusEvent[];
}

/** 待办 / 轨道不上天的去处。 */
export type OverviewExclusionReason =
  | "occurrence"
  | "child"
  | "rule-exhausted"
  | "done-old"
  | "track-concluded"
  | "track-parked";

/** 每个待办 / 每条轨道的去处。 */
export type OverviewPlacement =
  | { type: "star"; starKey: string }
  | { type: "excluded"; reason: OverviewExclusionReason; event: OverviewStatusEvent | null };

/** 全貌第一层：星、去处、按原因计数。 */
export interface OverviewStarIndex {
  /** 按 at 倒序，同一时刻按 key 升序。 */
  stars: OverviewStar[];
  /** 键为 "task:<id>" / "track:<id>"，每个待办、每条轨道恰好一条；速记不进。 */
  placements: Map<string, OverviewPlacement>;
  exclusions: Record<OverviewExclusionReason, number>;
}

/** 速记标题取第一行 trim 后非空的文字，超 80 码点截断。 */
function quickNoteTitle(text: string): string {
  let first = "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") {
      first = trimmed;
      break;
    }
  }
  const points = Array.from(first);
  return points.length > 80 ? `${points.slice(0, 80).join("")}…` : first;
}

/** 速记的 at 取 occurredAt 与 updatedAt 里晚的，相等取 occurredAt。 */
function quickNoteAt(note: QuickNote): string {
  return Date.parse(note.updatedAt) > Date.parse(note.occurredAt) ? note.updatedAt : note.occurredAt;
}

export function buildOverviewStars(input: {
  tasks: readonly Task[];
  tracks: readonly Track[];
  steps: readonly TrackStep[];
  quickNotes: readonly QuickNote[];
  now: Date;
}): OverviewStarIndex {
  const { tasks, tracks, steps, quickNotes, now } = input;
  const stars: OverviewStar[] = [];
  const starsByKey = new Map<string, OverviewStar>();
  const placements = new Map<string, OverviewPlacement>();
  const exclusions: Record<OverviewExclusionReason, number> = {
    occurrence: 0,
    child: 0,
    "rule-exhausted": 0,
    "done-old": 0,
    "track-concluded": 0,
    "track-parked": 0,
  };

  /** 速记直接成星，不进 placements。 */
  for (const note of quickNotes) {
    const star: OverviewStar = {
      key: `quick_note:${note.id}`,
      kind: "input",
      title: quickNoteTitle(note.text),
      searchText: note.text.toLowerCase(),
      at: quickNoteAt(note),
      pinned: note.pinned === true,
      href: `/quick-notes?date=${getDateString(new Date(note.occurredAt))}`,
      source: { type: "quick_note", note },
      extraEvents: [],
    };
    stars.push(star);
    starsByKey.set(star.key, star);
  }

  const stepsByTrackId = new Map<string, TrackStep[]>();
  for (const step of steps) {
    const list = stepsByTrackId.get(step.trackId) ?? [];
    list.push(step);
    stepsByTrackId.set(step.trackId, list);
  }

  /** 活跃轨道成星，其余按 status 记去处。 */
  for (const track of tracks) {
    const at = trackActivityAt(track, stepsByTrackId.get(track.id) ?? []);
    if (track.status === "active") {
      const star: OverviewStar = {
        key: `track:${track.id}`,
        kind: "progress",
        title: track.title,
        searchText: `${track.title} ${track.summary ?? ""}`.toLowerCase(),
        at,
        pinned: false,
        href: `/tracks/${encodeURIComponent(track.id)}`,
        source: { type: "track", track },
        extraEvents: [],
      };
      stars.push(star);
      starsByKey.set(star.key, star);
      placements.set(star.key, { type: "star", starKey: star.key });
    } else {
      const reason: OverviewExclusionReason = track.status === "concluded" ? "track-concluded" : "track-parked";
      exclusions[reason] += 1;
      placements.set(`track:${track.id}`, {
        type: "excluded",
        reason,
        event: { kind: "progress", at },
      });
    }
  }

  const byId = new Map<string, Task>();
  for (const task of tasks) byId.set(task.id, task);
  const occurrencesByRule = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.ruleId !== null) {
      const list = occurrencesByRule.get(task.ruleId) ?? [];
      list.push(task);
      occurrencesByRule.set(task.ruleId, list);
    }
  }
  const resolving = new Set<string>();

  /** 沿 parentId 上找根：断链、成环返回 null。 */
  function findRoot(task: Task): Task | null {
    if (task.parentId === null) return null;
    const visited = new Set<string>([task.id]);
    let currentId: string | null = task.parentId;
    while (currentId !== null) {
      const parent = byId.get(currentId);
      if (!parent) return null;
      if (visited.has(parent.id)) return null;
      if (parent.parentId === null) return parent;
      visited.add(parent.id);
      currentId = parent.parentId;
    }
    return null;
  }

  function starForTask(task: Task, kind: OverviewStarKind, at: string): OverviewPlacement {
    const star: OverviewStar = {
      key: `task:${task.id}`,
      kind,
      title: task.title,
      searchText: `${task.title} ${task.tags.join(" ")}`.toLowerCase(),
      at,
      pinned: false,
      href: `/todo?taskId=${encodeURIComponent(task.id)}`,
      source: { type: "task", task },
      extraEvents: [],
    };
    stars.push(star);
    starsByKey.set(star.key, star);
    const placement: OverviewPlacement = { type: "star", starKey: star.key };
    placements.set(star.key, placement);
    return placement;
  }

  /** 根待办按口径从上往下先命中先停。 */
  function judgeAsRoot(task: Task): OverviewPlacement {
    if (task.recurrence !== null && isRuleExhausted(task, occurrencesByRule.get(task.id) ?? [])) {
      exclusions["rule-exhausted"] += 1;
      const placement: OverviewPlacement = { type: "excluded", reason: "rule-exhausted", event: null };
      placements.set(`task:${task.id}`, placement);
      return placement;
    }
    if (task.recurrence !== null) {
      const occurrences = occurrencesByRule.get(task.id) ?? [];
      let at = task.updatedAt;
      let atMs = Date.parse(at);
      for (const occurrence of occurrences) {
        if (!occurrence.done) continue;
        const candidate = occurrence.completedAt ?? occurrence.updatedAt;
        const candidateMs = Date.parse(candidate);
        if (candidateMs > atMs) {
          at = candidate;
          atMs = candidateMs;
        }
      }
      return starForTask(task, "recurring", at);
    }
    if (task.ruleId !== null && byId.has(task.ruleId) && !resolving.has(task.ruleId)) {
      exclusions.occurrence += 1;
      const template = byId.get(task.ruleId) ?? task;
      const resolved = resolve(template);
      const placement: OverviewPlacement =
        resolved.type === "star" ? resolved : { type: "excluded", reason: "occurrence", event: null };
      placements.set(`task:${task.id}`, placement);
      return placement;
    }
    if (task.ruleId !== null && !byId.has(task.ruleId) && task.skipped) {
      exclusions.occurrence += 1;
      const placement: OverviewPlacement = { type: "excluded", reason: "occurrence", event: null };
      placements.set(`task:${task.id}`, placement);
      return placement;
    }
    if (task.done) {
      const doneAt = task.completedAt ?? task.updatedAt;
      if (isWithinOverviewDays(doneAt, now, OVERVIEW_DONE_WINDOW_DAYS)) {
        return starForTask(task, "done", doneAt);
      }
      exclusions["done-old"] += 1;
      const placement: OverviewPlacement = {
        type: "excluded",
        reason: "done-old",
        event: { kind: "done", at: doneAt },
      };
      placements.set(`task:${task.id}`, placement);
      return placement;
    }
    return starForTask(task, "input", task.updatedAt);
  }

  function resolve(task: Task): OverviewPlacement {
    const key = `task:${task.id}`;
    const cached = placements.get(key);
    if (cached) return cached;
    resolving.add(task.id);
    const root = findRoot(task);
    let placement: OverviewPlacement;
    if (root !== null && !resolving.has(root.id)) {
      exclusions.child += 1;
      const resolvedRoot = resolve(root);
      if (resolvedRoot.type === "star") {
        placement = resolvedRoot;
        if (task.done) {
          starsByKey.get(resolvedRoot.starKey)?.extraEvents.push({
            kind: "done",
            at: task.completedAt ?? task.updatedAt,
          });
        }
      } else {
        placement = { type: "excluded", reason: "child", event: null };
      }
      placements.set(key, placement);
    } else {
      placement = judgeAsRoot(task);
    }
    resolving.delete(task.id);
    return placement;
  }

  for (const task of tasks) resolve(task);

  /** 按 at 倒序，同一时刻按 key 升序。 */
  stars.sort((a, b) => {
    const diff = Date.parse(b.at) - Date.parse(a.at);
    if (diff !== 0) return diff;
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  });

  return { stars, placements, exclusions };
}
