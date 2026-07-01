import type { GoalMemberRef, Task, Track, TrackStep } from "@timedata/shared";
import { groupStepsByTrack, latestBoardSignal, latestStep, type TrackBoardSignal } from "../../lib/tracksView.js";
import { placementForTask } from "../../lib/tasks/placement.js";
import { filterTasks, type TaskFilter } from "../../lib/tasks/turnTags.js";

export type GoalTaskCandidateGroupKey = "today" | "inbox" | "scheduled";
export type GoalTrackCandidateGroupKey = "active" | "parked" | "concluded";

export interface GoalTaskCandidate {
  task: Task;
  group: GoalTaskCandidateGroupKey;
  overdue: boolean;
  children: Task[];
}

export interface GoalTrackCandidate {
  track: Track;
  group: GoalTrackCandidateGroupKey;
  latestStep: TrackStep | null;
  signal: TrackBoardSignal | null;
}

export interface GoalTaskCandidateOptions extends TaskFilter {
  now: Date;
}

export interface GoalTrackCandidateOptions {
  searchQuery: string;
  boardSignals: readonly string[];
}

export interface GoalTaskCandidateGroup {
  key: GoalTaskCandidateGroupKey;
  label: string;
  items: GoalTaskCandidate[];
}

export interface GoalTrackCandidateGroup {
  key: GoalTrackCandidateGroupKey;
  label: string;
  items: GoalTrackCandidate[];
}

const TASK_GROUP_ORDER: GoalTaskCandidateGroupKey[] = ["today", "inbox", "scheduled"];
const TRACK_GROUP_ORDER: GoalTrackCandidateGroupKey[] = ["active", "parked", "concluded"];

const TASK_GROUP_LABEL: Record<GoalTaskCandidateGroupKey, string> = {
  today: "今天",
  inbox: "收件箱",
  scheduled: "已排期",
};

const TRACK_GROUP_LABEL: Record<GoalTrackCandidateGroupKey, string> = {
  active: "active",
  parked: "parked",
  concluded: "concluded",
};

function memberKey(ref: GoalMemberRef): string {
  return `${ref.kind}:${ref.id}`;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "zh-Hans-CN") || left.localeCompare(right) || 0;
}

function compareTaskStable(left: Task, right: Task): number {
  return compareText(left.title, right.title) || left.id.localeCompare(right.id);
}

/** 落点映射到托盘三池；重复 / 已完成 / 已耗尽一律返回 null（不进托盘）。 */
function taskGroup(task: Task, now: Date): { group: GoalTaskCandidateGroupKey; overdue: boolean } | null {
  const placement = placementForTask(task, now);
  if (placement.pool === "today") return { group: "today", overdue: placement.overdue };
  if (placement.pool === "inbox") return { group: "inbox", overdue: false };
  if (placement.pool === "upcoming") return { group: "scheduled", overdue: false };
  return null;
}

function compareTaskCandidate(left: GoalTaskCandidate, right: GoalTaskCandidate): number {
  const byGroup = TASK_GROUP_ORDER.indexOf(left.group) - TASK_GROUP_ORDER.indexOf(right.group);
  if (byGroup !== 0) return byGroup;
  if (left.group === "scheduled") {
    return (
      (left.task.scheduledAt ?? "").localeCompare(right.task.scheduledAt ?? "") ||
      compareTaskStable(left.task, right.task)
    );
  }
  // today / inbox：镜像待办页手动顺序（sortOrder 升序），再稳定兜底。
  return left.task.sortOrder - right.task.sortOrder || compareTaskStable(left.task, right.task);
}

/** 未完成子任务按 parentId 归组，组内按 sortOrder 升序。 */
function openChildrenByParent(tasks: readonly Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.parentId === null || task.done) continue;
    const list = map.get(task.parentId) ?? [];
    list.push(task);
    map.set(task.parentId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || compareTaskStable(a, b));
  return map;
}

function searchTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function matchesTrackSearch(track: Track, query: string): boolean {
  const terms = searchTerms(query);
  if (terms.length === 0) return true;
  const haystack = track.title.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function compareTrackCandidate(left: GoalTrackCandidate, right: GoalTrackCandidate): number {
  return (
    TRACK_GROUP_ORDER.indexOf(left.group) - TRACK_GROUP_ORDER.indexOf(right.group) ||
    right.track.updatedAt.localeCompare(left.track.updatedAt) ||
    compareText(left.track.title, right.track.title) ||
    left.track.id.localeCompare(right.track.id)
  );
}

export function buildGoalTaskCandidates(
  tasks: Task[],
  members: readonly GoalMemberRef[],
  options: GoalTaskCandidateOptions,
): GoalTaskCandidate[] {
  const memberKeys = new Set(members.map(memberKey));
  const childrenByParent = openChildrenByParent(tasks);
  const roots = tasks.filter((task) => task.parentId === null && !memberKeys.has(`task:${task.id}`));
  const candidates: GoalTaskCandidate[] = [];
  for (const task of filterTasks(roots, options)) {
    const grouped = taskGroup(task, options.now);
    if (!grouped) continue;
    candidates.push({
      task,
      group: grouped.group,
      overdue: grouped.overdue,
      children: childrenByParent.get(task.id) ?? [],
    });
  }
  return candidates.sort(compareTaskCandidate);
}

export function taskCandidateGroups(candidates: readonly GoalTaskCandidate[]): GoalTaskCandidateGroup[] {
  return TASK_GROUP_ORDER.map((key) => ({
    key,
    label: TASK_GROUP_LABEL[key],
    items: candidates.filter((candidate) => candidate.group === key),
  })).filter((group) => group.items.length > 0);
}

export function buildGoalTrackCandidates(
  tracks: Track[],
  steps: TrackStep[],
  members: readonly GoalMemberRef[],
  options: GoalTrackCandidateOptions,
): GoalTrackCandidate[] {
  const memberKeys = new Set(members.map(memberKey));
  const stepsByTrack = groupStepsByTrack(steps);
  return tracks
    .filter((track) => !memberKeys.has(`track:${track.id}`))
    .filter((track) => matchesTrackSearch(track, options.searchQuery))
    .map((track) => {
      const trackSteps = stepsByTrack.get(track.id) ?? [];
      return {
        track,
        group: track.status,
        latestStep: latestStep(trackSteps),
        signal: latestBoardSignal(trackSteps, options.boardSignals),
      };
    })
    .sort(compareTrackCandidate);
}

export function trackCandidateGroups(candidates: readonly GoalTrackCandidate[]): GoalTrackCandidateGroup[] {
  return TRACK_GROUP_ORDER.map((key) => ({
    key,
    label: TRACK_GROUP_LABEL[key],
    items: candidates.filter((candidate) => candidate.group === key),
  })).filter((group) => group.items.length > 0);
}
