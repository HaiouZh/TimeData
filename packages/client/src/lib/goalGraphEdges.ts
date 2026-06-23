import type { GoalMemberRef, GoalPrerequisite } from "@timedata/shared";

export type PrerequisiteEdgeError = "self-reference" | "non-member" | "duplicate" | "cycle" | "goal-anchor";

export interface PrerequisiteValidationResult {
  ok: boolean;
  error?: PrerequisiteEdgeError;
}

type GoalAnchorRef = { kind: "goal"; id: string };
type PrerequisiteEndpoint = GoalMemberRef | GoalAnchorRef;
type GoalLike = {
  members: GoalMemberRef[];
  prerequisites: GoalPrerequisite[];
};

function endpointKey(ref: PrerequisiteEndpoint): string {
  return `${ref.kind}:${ref.id}`;
}

function memberKey(ref: GoalMemberRef): string {
  return endpointKey(ref);
}

function isGoalAnchor(ref: PrerequisiteEndpoint): ref is GoalAnchorRef {
  return ref.kind === "goal";
}

function sameEndpoint(left: PrerequisiteEndpoint, right: PrerequisiteEndpoint): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function buildAdjacency(goalLike: GoalLike): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of goalLike.prerequisites ?? []) {
    const blocker = memberKey(edge.blocker);
    const blocked = memberKey(edge.blocked);
    const members = new Set((goalLike.members ?? []).map(memberKey));
    if (!members.has(blocker) || !members.has(blocked)) continue;
    const list = adjacency.get(blocker) ?? [];
    list.push(blocked);
    adjacency.set(blocker, list);
  }
  return adjacency;
}

function hasPath(adjacency: Map<string, string[]>, from: string, to: string): boolean {
  const visited = new Set<string>();
  const stack = [...(adjacency.get(from) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    if (current === to) return true;
    visited.add(current);
    const next = adjacency.get(current);
    if (next) stack.push(...next);
  }

  return false;
}

export function validatePrerequisiteEdge(
  goalLike: GoalLike,
  blocker: PrerequisiteEndpoint,
  blocked: PrerequisiteEndpoint,
): PrerequisiteValidationResult {
  if (isGoalAnchor(blocker) || isGoalAnchor(blocked)) return { ok: false, error: "goal-anchor" };
  if (sameEndpoint(blocker, blocked)) return { ok: false, error: "self-reference" };

  const members = new Set((goalLike.members ?? []).map(memberKey));
  if (!members.has(memberKey(blocker)) || !members.has(memberKey(blocked))) {
    return { ok: false, error: "non-member" };
  }

  if (
    (goalLike.prerequisites ?? []).some(
      (edge) => sameEndpoint(edge.blocker, blocker) && sameEndpoint(edge.blocked, blocked),
    )
  ) {
    return { ok: false, error: "duplicate" };
  }

  const adjacency = buildAdjacency(goalLike);
  if (hasPath(adjacency, memberKey(blocked), memberKey(blocker))) {
    return { ok: false, error: "cycle" };
  }

  return { ok: true };
}

export function addPrerequisiteEdge<T extends GoalLike>(
  goalLike: T,
  blocker: PrerequisiteEndpoint,
  blocked: PrerequisiteEndpoint,
): T {
  const validation = validatePrerequisiteEdge(goalLike, blocker, blocked);
  if (!validation.ok) throw new Error(validation.error);

  return {
    ...goalLike,
    prerequisites: [
      ...goalLike.prerequisites,
      {
        blocker: { kind: blocker.kind, id: blocker.id },
        blocked: { kind: blocked.kind, id: blocked.id },
      },
    ],
  };
}

export function removePrerequisiteEdge<T extends GoalLike>(
  goalLike: T,
  blocker: PrerequisiteEndpoint,
  blocked: PrerequisiteEndpoint,
): T {
  return {
    ...goalLike,
    prerequisites: goalLike.prerequisites.filter(
      (edge) => !(sameEndpoint(edge.blocker, blocker) && sameEndpoint(edge.blocked, blocked)),
    ),
  };
}
