import type {
  Goal,
  OverviewClusterStatus,
  OverviewStarKind,
  OverviewStatusEvent,
} from "@timedata/shared";
import {
  computeOverviewClusterStatus,
  isOverviewStarDark,
  overviewTitlePrefix,
} from "@timedata/shared";
import type { OverviewExclusionReason, OverviewStar, OverviewStarIndex } from "./overviewStars.js";

/** 团的种类：目标团、前缀小团、散着。 */
export type OverviewClusterKind = "goal" | "prefix" | "loose";

/** 全貌上的一团。 */
export interface OverviewCluster {
  key: string;
  kind: OverviewClusterKind;
  title: string;
  goalId: string | null;
  status: OverviewClusterStatus | null;
  lastActivityAt: string | null;
  quietDays: number | null;
  litStars: OverviewStar[];
  darkStars: OverviewStar[];
  kindCounts: Record<OverviewStarKind, number>;
}

/** 全貌的对账计数。 */
export interface OverviewTally {
  totalStars: number;
  litStars: number;
  darkStars: number;
  starsByKind: Record<OverviewStarKind, number>;
  exclusions: Record<OverviewExclusionReason, number>;
  danglingMemberRefs: number;
  archivedGoals: number;
}

/** 全貌第二层：排好序的团与对账计数。 */
export interface OverviewModel {
  clusters: OverviewCluster[];
  tally: OverviewTally;
}

/** 状态排序用的名次。 */
const STATUS_ORDER: Record<OverviewClusterStatus, number> = {
  moving: 0,
  saving: 1,
  fixed: 2,
  shelved: 3,
  empty: 4,
};

/** 空的四种计数。 */
function emptyKindCounts(): Record<OverviewStarKind, number> {
  return { input: 0, done: 0, progress: 0, recurring: 0 };
}

/** 按星种计数，四个键都在。 */
export function countOverviewStarKinds(stars: readonly OverviewStar[]): Record<OverviewStarKind, number> {
  const counts = emptyKindCounts();
  for (const star of stars) counts[star.kind] += 1;
  return counts;
}

/** 按 index.stars 同样的规则排序：at 倒序，同刻 key 升序。 */
function compareStars(a: OverviewStar, b: OverviewStar): number {
  const diff = Date.parse(b.at) - Date.parse(a.at);
  if (diff !== 0) return diff;
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
}

interface ClusterBuilder {
  key: string;
  kind: OverviewClusterKind;
  title: string;
  goalId: string | null;
  stars: OverviewStar[];
  seen: Set<string>;
  excludedEvents: OverviewStatusEvent[];
}

/** 建一团事情。 */
export function buildOverviewModel(input: {
  goals: readonly Goal[];
  index: OverviewStarIndex;
  now: Date;
}): OverviewModel {
  const { goals, index, now } = input;
  let danglingMemberRefs = 0;
  let archivedGoals = 0;

  const starsByKey = new Map<string, OverviewStar>();
  for (const star of index.stars) starsByKey.set(star.key, star);

  const activeGoals = goals.filter((g) => g.status === "active");
  archivedGoals = goals.length - activeGoals.length;

  const goalBuilders: ClusterBuilder[] = activeGoals.map((g) => ({
    key: `goal:${g.id}`,
    kind: "goal",
    title: g.title,
    goalId: g.id,
    stars: [],
    seen: new Set<string>(),
    excludedEvents: [],
  }));

  for (let i = 0; i < activeGoals.length; i++) {
    const goal = activeGoals[i];
    const builder = goalBuilders[i];
    if (!goal || !builder) continue;
    for (const member of goal.members) {
      const placement = index.placements.get(`${member.kind}:${member.id}`);
      if (!placement) {
        danglingMemberRefs += 1;
        continue;
      }
      if (placement.type === "star") {
        if (builder.seen.has(placement.starKey)) continue;
        builder.seen.add(placement.starKey);
        const star = starsByKey.get(placement.starKey);
        if (star) builder.stars.push(star);
      } else if (placement.event !== null) {
        builder.excludedEvents.push(placement.event);
      }
    }
  }

  const inGoalKeys = new Set<string>();
  for (const builder of goalBuilders) {
    for (const key of builder.seen) inGoalKeys.add(key);
  }

  const goalTitleToBuilders = new Map<string, ClusterBuilder[]>();
  for (let i = 0; i < activeGoals.length; i++) {
    const goal = activeGoals[i];
    const builder = goalBuilders[i];
    if (!goal || !builder) continue;
    const norm = goal.title.trim().toLowerCase();
    const list = goalTitleToBuilders.get(norm) ?? [];
    list.push(builder);
    goalTitleToBuilders.set(norm, list);
  }

  const prefixBuilders = new Map<string, ClusterBuilder>();
  const assignedKeys = new Set<string>(inGoalKeys);
  for (const star of index.stars) {
    if (inGoalKeys.has(star.key)) continue;
    if (star.kind !== "done") continue;
    const p = overviewTitlePrefix(star.title);
    if (p === null) continue;
    const normP = p.toLowerCase();
    const matched = goalTitleToBuilders.get(normP);
    if (matched) {
      for (const builder of matched) {
        if (builder.seen.has(star.key)) continue;
        builder.seen.add(star.key);
        builder.stars.push(star);
      }
      assignedKeys.add(star.key);
    } else {
      let builder = prefixBuilders.get(normP);
      if (!builder) {
        builder = {
          key: `prefix:${normP}`,
          kind: "prefix",
          title: p,
          goalId: null,
          stars: [],
          seen: new Set<string>(),
          excludedEvents: [],
        };
        prefixBuilders.set(normP, builder);
      }
      if (builder.seen.has(star.key)) continue;
      builder.seen.add(star.key);
      builder.stars.push(star);
      assignedKeys.add(star.key);
    }
  }

  const looseStars = index.stars.filter((s) => !assignedKeys.has(s.key));
  let looseBuilder: ClusterBuilder | null = null;
  if (looseStars.length > 0) {
    looseBuilder = {
      key: "loose",
      kind: "loose",
      title: "还没归到哪件事",
      goalId: null,
      stars: [...looseStars],
      seen: new Set<string>(looseStars.map((s) => s.key)),
      excludedEvents: [],
    };
  }

  /** 把一团的星排序并切出暗处，再算状态与计数。 */
  function finalize(builder: ClusterBuilder): OverviewCluster {
    const sorted = [...builder.stars].sort(compareStars);
    const litStars: OverviewStar[] = [];
    const darkStars: OverviewStar[] = [];
    for (const star of sorted) {
      const dark = isOverviewStarDark({
        assigned: builder.kind !== "loose",
        pinned: star.pinned,
        at: star.at,
        now,
      });
      if (dark) darkStars.push(star);
      else litStars.push(star);
    }
    const kindCounts = countOverviewStarKinds(sorted);
    if (builder.kind === "loose") {
      return {
        key: builder.key,
        kind: builder.kind,
        title: builder.title,
        goalId: builder.goalId,
        status: null,
        lastActivityAt: null,
        quietDays: null,
        litStars,
        darkStars,
        kindCounts,
      };
    }
    const events: OverviewStatusEvent[] = [];
    for (const star of builder.stars) {
      events.push({ kind: star.kind, at: star.at });
      for (const extra of star.extraEvents) events.push(extra);
    }
    for (const event of builder.excludedEvents) events.push(event);
    const result = computeOverviewClusterStatus({ events, now });
    return {
      key: builder.key,
      kind: builder.kind,
      title: builder.title,
      goalId: builder.goalId,
      status: result.status,
      lastActivityAt: result.lastActivityAt,
      quietDays: result.quietDays,
      litStars,
      darkStars,
      kindCounts,
    };
  }

  const mainClusters = [...goalBuilders, ...prefixBuilders.values()].map(finalize);
  mainClusters.sort((a, b) => {
    const orderA = a.status === null ? 99 : STATUS_ORDER[a.status];
    const orderB = b.status === null ? 99 : STATUS_ORDER[b.status];
    if (orderA !== orderB) return orderA - orderB;
    if (a.lastActivityAt !== null || b.lastActivityAt !== null) {
      if (a.lastActivityAt === null) return 1;
      if (b.lastActivityAt === null) return -1;
      const diff = Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
      if (diff !== 0) return diff;
    }
    return a.title.localeCompare(b.title, "zh");
  });

  const clusters: OverviewCluster[] = [...mainClusters];
  if (looseBuilder) clusters.push(finalize(looseBuilder));

  const starsByKind = emptyKindCounts();
  for (const star of index.stars) starsByKind[star.kind] += 1;
  const darkStars = looseBuilder
    ? clusters[clusters.length - 1]?.darkStars.length ?? 0
    : 0;

  return {
    clusters,
    tally: {
      totalStars: index.stars.length,
      litStars: index.stars.length - darkStars,
      darkStars,
      starsByKind,
      exclusions: { ...index.exclusions },
      danglingMemberRefs,
      archivedGoals,
    },
  };
}

/** 按团的顺序给出每颗星所在的全部团名。 */
export function clusterTitlesByStarKey(
  clusters: readonly OverviewCluster[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const cluster of clusters) {
    for (const star of [...cluster.litStars, ...cluster.darkStars]) {
      const list = result.get(star.key) ?? [];
      list.push(cluster.title);
      result.set(star.key, list);
    }
  }
  return result;
}
