import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { GoalGraphNodeBox } from "./goalGraphLayout.js";

export interface XY {
  x: number;
  y: number;
}

export interface SettleNodeInput {
  id: string;
  seed: XY;
  box: GoalGraphNodeBox;
  fixed: boolean;
  anchorId?: string;
  anchorIds?: string[];
}

export interface SettleLinkInput {
  source: string;
  target: string;
  kind: "tether" | "prerequisite" | "bridge";
}

export interface GalaxySettleInput {
  nodes: SettleNodeInput[];
  links: SettleLinkInput[];
  anchorById: Record<string, XY>;
}

export interface SettleTickResult {
  alpha: number;
  positions: Record<string, XY>;
}

export interface GalaxySettleSim {
  tick(): SettleTickResult;
  reheat(alpha?: number): void;
  setLive(live: boolean): void;
  setDragPin(id: string, pos: XY | null): void;
  syncModel(input: GalaxySettleInput): void;
  isSettled(): boolean;
  stop(): void;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  box: GoalGraphNodeBox;
  fixed: boolean;
  anchorId?: string;
  anchorIds?: string[];
}

type SimLink = SimulationLinkDatum<SimNode> & { kind: SettleLinkInput["kind"] };
type OrbitState = {
  angular: number;
  targetAngular: number;
  nextChangeTick: number;
  rng: number;
  baseStep: number;
  gravity: number;
  turnEase: number;
  changeMin: number;
  changeSpan: number;
  direction: -1 | 1;
  innerDistance: number;
  softMaxDistance: number;
  tangentialGain: number;
};

export const SETTLE_ALPHA_MIN = 0.02;
const CHARGE_STRENGTH = -180;
const LIVE_CHARGE_STRENGTH = -18;
const COLLIDE_PADDING = 8;
const ANCHOR_PULL = 0.09;
const LIVE_ALPHA_TARGET = 0.012;
const LIVE_REHEAT_ALPHA = 0.04;
const ORBIT_STEP = 0.00145;
const LIVE_GRAVITY_PULL = 0.0048;
const LIVE_GRAVITY_MAX_STEP = 2.2;
const LIVE_INNER_PUSH = 0.004;
const LIVE_INNER_MAX_STEP = 0.42;
const LIVE_PREREQ_DISTANCE = 155;
const LIVE_PREREQ_PULL = 0.0018;
const LIVE_PREREQ_MAX_STEP = 0.86;
const ORBIT_RADIUS: Record<SettleLinkInput["kind"], number> = { tether: 112, prerequisite: 155, bridge: 220 };
const LINK_DISTANCE: Record<SettleLinkInput["kind"], number> = { tether: 105, prerequisite: 155, bridge: 220 };
const LINK_STRENGTH: Record<SettleLinkInput["kind"], number> = { tether: 0.62, prerequisite: 0.24, bridge: 0.2 };
const LIVE_COLLISION_PADDING = 10;
const LIVE_COLLISION_ITERATIONS = 4;
const LIVE_COLLISION_MAX_PUSH = 28;
const LIVE_COLLISION_RELAX = 0.72;
const LIVE_LINK_STRENGTH: Record<SettleLinkInput["kind"], number> = {
  tether: 0.004,
  prerequisite: 0,
  bridge: 0.006,
};

function collideRadius(box: GoalGraphNodeBox): number {
  return Math.hypot(box.width, box.height) / 2 + COLLIDE_PADDING;
}

function boxCenter(node: SimNode): XY {
  return {
    x: (node.x ?? 0) + (node.box.offsetX ?? 0),
    y: (node.y ?? 0) + (node.box.offsetY ?? 0),
  };
}

function liveCollisionWeight(node: SimNode, dragPins: ReadonlyMap<string, XY>, seedLocks: ReadonlyMap<string, XY>): 0 | 1 {
  return node.fixed || dragPins.has(node.id) || seedLocks.has(node.id) ? 0 : 1;
}

function applyFixed(node: SimNode): void {
  if (node.fixed) {
    node.fx = node.x;
    node.fy = node.y;
  }
}

function lockFixedToSeed(node: SimNode, seed: XY): void {
  node.x = seed.x;
  node.y = seed.y;
  node.fx = seed.x;
  node.fy = seed.y;
  node.vx = 0;
  node.vy = 0;
}

function hashId(id: string, salt = 0): number {
  let hash = (2166136261 ^ salt) >>> 0;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function orbitDirection(anchorId: string): -1 | 1 {
  return hashId(anchorId, 131) % 2 === 0 ? -1 : 1;
}

function nextRandom(state: OrbitState): number {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 0xffffffff;
}

function createOrbitState(id: string, anchorId: string, seedDistance: number): OrbitState {
  const state: OrbitState = {
    angular: 0,
    targetAngular: 0,
    nextChangeTick: 0,
    rng: hashId(id, 311) || 1,
    baseStep: ORBIT_STEP,
    gravity: LIVE_GRAVITY_PULL,
    turnEase: 0.025,
    changeMin: 35,
    changeSpan: 120,
    direction: 1,
    innerDistance: 72,
    softMaxDistance: 320,
    tangentialGain: 0.72,
  };
  state.baseStep = ORBIT_STEP * (0.28 + nextRandom(state) * 2.25);
  state.gravity = LIVE_GRAVITY_PULL * (0.78 + nextRandom(state) * 0.34);
  state.turnEase = 0.006 + nextRandom(state) * 0.014;
  state.changeMin = 90 + Math.floor(nextRandom(state) * 190);
  state.changeSpan = 150 + Math.floor(nextRandom(state) * 320);
  state.innerDistance = Math.max(56, Math.min(150, seedDistance * (0.34 + nextRandom(state) * 0.18)));
  state.softMaxDistance = Math.max(145, Math.min(235, 150 + nextRandom(state) * 70 + Math.min(seedDistance, 360) * 0.08));
  state.tangentialGain = 0.28 + nextRandom(state) * 1.24;
  state.direction = orbitDirection(anchorId);
  state.angular = state.direction * state.baseStep * (0.18 + nextRandom(state) * 0.82);
  state.targetAngular = state.baseStep * state.direction * (0.18 + nextRandom(state) * 1.95);
  state.nextChangeTick = state.changeMin + Math.floor(nextRandom(state) * state.changeSpan);
  return state;
}

function refreshOrbitTarget(state: OrbitState, id: string, liveTick: number): void {
  if (liveTick < state.nextChangeTick) return;
  const speed = 0.18 + nextRandom(state) * 1.95;
  state.targetAngular = state.baseStep * state.direction * speed;
  state.nextChangeTick = liveTick + state.changeMin + Math.floor(nextRandom(state) * state.changeSpan);
  if (id.length === 0) state.targetAngular = 0;
}

export function createGalaxySettleSim(input: GalaxySettleInput): GalaxySettleSim {
  let anchorById = input.anchorById;
  let live = false;
  let liveTick = 0;
  const dragPins = new Map<string, XY>();
  const anchorOverrides = new Map<string, XY>();
  const orbitStates = new Map<string, OrbitState>();
  const seedLocks = new Map<string, XY>();

  function buildNodes(source: GalaxySettleInput): SimNode[] {
    return source.nodes.map((node) => {
      const sim: SimNode = {
        id: node.id,
        box: node.box,
        fixed: node.fixed,
        anchorId: node.anchorId,
        anchorIds: node.anchorIds,
        x: node.seed.x,
        y: node.seed.y,
      };
      applyFixed(sim);
      return sim;
    });
  }

  let nodes = buildNodes(input);
  let nodeById = new Map(nodes.map((node) => [node.id, node]));

  function buildLinks(source: GalaxySettleInput): SimLink[] {
    return source.links
      .filter((link) => nodeById.has(link.source) && nodeById.has(link.target))
      .map((link) => ({ source: link.source, target: link.target, kind: link.kind }));
  }

  function linkStrength(link: SimLink): number {
    return (live ? LIVE_LINK_STRENGTH : LINK_STRENGTH)[link.kind];
  }

  function chargeStrength(): number {
    return live ? LIVE_CHARGE_STRENGTH : CHARGE_STRENGTH;
  }

  function linkForce(): ReturnType<typeof forceLink<SimNode, SimLink>> | undefined {
    return simulation.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>> | undefined;
  }

  function chargeForce(): ReturnType<typeof forceManyBody<SimNode>> | undefined {
    return simulation.force("charge") as ReturnType<typeof forceManyBody<SimNode>> | undefined;
  }

  function refreshLinkStrength(): void {
    linkForce()?.strength((link) => linkStrength(link));
  }

  function refreshChargeStrength(): void {
    chargeForce()?.strength(chargeStrength());
  }

  function nodeAnchorIds(node: SimNode): string[] {
    const ids = node.anchorIds?.length ? [...node.anchorIds] : [];
    if (node.anchorId && !ids.includes(node.anchorId)) ids.unshift(node.anchorId);
    return ids;
  }

  function anchorPosition(anchorId: string): XY | null {
    const anchorNode = nodeById.get(anchorId);
    if (anchorNode?.fixed) {
      return {
        x: anchorNode.x ?? anchorNode.fx ?? anchorById[anchorId]?.x ?? 0,
        y: anchorNode.y ?? anchorNode.fy ?? anchorById[anchorId]?.y ?? 0,
      };
    }
    const anchor = anchorById[anchorId];
    if (anchor) return anchor;
    if (!anchorNode) return null;
    return { x: anchorNode.x ?? 0, y: anchorNode.y ?? 0 };
  }

  function anchorCenter(node: SimNode): XY | null {
    if (node.anchorId) return anchorPosition(node.anchorId);
    const anchors = nodeAnchorIds(node).map(anchorPosition).filter((point): point is XY => point !== null);
    if (anchors.length === 0) return null;
    return {
      x: anchors.reduce((sum, point) => sum + point.x, 0) / anchors.length,
      y: anchors.reduce((sum, point) => sum + point.y, 0) / anchors.length,
    };
  }

  function anchorSystemKey(node: SimNode): string {
    if (node.anchorId) return node.anchorId;
    return nodeAnchorIds(node).sort().join("|");
  }

  function applyOrbitStep(): void {
    if (!live) return;
    liveTick += 1;
    for (const node of nodes) {
      if (node.fixed || dragPins.has(node.id) || seedLocks.has(node.id)) continue;
      const anchor = anchorCenter(node);
      if (!anchor) continue;
      const dx = (node.x ?? 0) - anchor.x;
      const dy = (node.y ?? 0) - anchor.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 1) continue;
      const state = orbitStates.get(node.id) ?? createOrbitState(node.id, anchorSystemKey(node), distance);
      orbitStates.set(node.id, state);
      refreshOrbitTarget(state, node.id, liveTick);
      state.angular += (state.targetAngular - state.angular) * state.turnEase;
      const tangentStep = distance * state.angular * state.tangentialGain;
      const farRatio = Math.max(0, distance - state.softMaxDistance) / Math.max(1, state.softMaxDistance);
      const gravityStep = Math.min(LIVE_GRAVITY_MAX_STEP, farRatio * farRatio * state.softMaxDistance * state.gravity);
      const innerDistance = Math.max(0, state.innerDistance - distance);
      const innerStep = Math.min(LIVE_INNER_MAX_STEP, innerDistance * LIVE_INNER_PUSH);
      const unitX = dx / distance;
      const unitY = dy / distance;
      node.x = (node.x ?? 0) + -unitY * tangentStep - unitX * gravityStep + unitX * innerStep;
      node.y = (node.y ?? 0) + unitX * tangentStep - unitY * gravityStep + unitY * innerStep;
      node.vx = 0;
      node.vy = 0;
    }
  }

  function liveMotionWeight(node: SimNode): 0 | 1 {
    return node.fixed || dragPins.has(node.id) || seedLocks.has(node.id) ? 0 : 1;
  }

  function simLinkNode(value: SimLink["source"] | SimLink["target"]): SimNode | null {
    if (typeof value === "string") return nodeById.get(value) ?? null;
    if (typeof value === "number") return nodes[value] ?? null;
    return value;
  }

  function applyLivePrerequisitePull(): void {
    if (!live) return;
    const links = linkForce()?.links() ?? [];
    for (const link of links) {
      if (link.kind !== "prerequisite") continue;
      const source = simLinkNode(link.source);
      const target = simLinkNode(link.target);
      if (!source || !target) continue;
      const sourceWeight = liveMotionWeight(source);
      const targetWeight = liveMotionWeight(target);
      if (sourceWeight === 0 && targetWeight === 0) continue;

      const dx = (target.x ?? 0) - (source.x ?? 0);
      const dy = (target.y ?? 0) - (source.y ?? 0);
      const distance = Math.hypot(dx, dy);
      if (distance <= LIVE_PREREQ_DISTANCE || distance < 1) continue;

      const ratio = (distance - LIVE_PREREQ_DISTANCE) / LIVE_PREREQ_DISTANCE;
      const step = Math.min(LIVE_PREREQ_MAX_STEP, ratio * ratio * LIVE_PREREQ_DISTANCE * LIVE_PREREQ_PULL);
      const unitX = dx / distance;
      const unitY = dy / distance;
      const totalWeight = sourceWeight + targetWeight;
      const sourceStep = sourceWeight === 0 ? 0 : (step * targetWeight) / totalWeight;
      const targetStep = targetWeight === 0 ? 0 : (step * sourceWeight) / totalWeight;

      if (sourceWeight) {
        source.x = (source.x ?? 0) + unitX * sourceStep;
        source.y = (source.y ?? 0) + unitY * sourceStep;
        source.vx = 0;
        source.vy = 0;
      }
      if (targetWeight) {
        target.x = (target.x ?? 0) - unitX * targetStep;
        target.y = (target.y ?? 0) - unitY * targetStep;
        target.vx = 0;
        target.vy = 0;
      }
    }
  }

  function anchorPullStrength(node: SimNode): number {
    if (nodeAnchorIds(node).length === 0) return 0;
    return live ? 0 : ANCHOR_PULL;
  }

  function translateAnchoredNodes(anchorId: string, delta: XY): void {
    if (delta.x === 0 && delta.y === 0) return;
    for (const node of nodes) {
      const anchors = nodeAnchorIds(node);
      if (node.fixed || !anchors.includes(anchorId) || dragPins.has(node.id) || seedLocks.has(node.id)) continue;
      const factor = 1 / Math.max(1, anchors.length);
      node.x = (node.x ?? 0) + delta.x * factor;
      node.y = (node.y ?? 0) + delta.y * factor;
      node.vx = 0;
      node.vy = 0;
    }
  }

  function applyLiveCollisions(): void {
    for (let iter = 0; iter < LIVE_COLLISION_ITERATIONS; iter += 1) {
      let moved = false;
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const left = nodes[i];
          const right = nodes[j];
          const leftWeight = liveCollisionWeight(left, dragPins, seedLocks);
          const rightWeight = liveCollisionWeight(right, dragPins, seedLocks);
          if (leftWeight === 0 && rightWeight === 0) continue;

          const leftCenter = boxCenter(left);
          const rightCenter = boxCenter(right);
          const overlapX =
            (left.box.width + right.box.width) / 2 + LIVE_COLLISION_PADDING - Math.abs(rightCenter.x - leftCenter.x);
          const overlapY =
            (left.box.height + right.box.height) / 2 + LIVE_COLLISION_PADDING - Math.abs(rightCenter.y - leftCenter.y);
          if (overlapX <= 0 || overlapY <= 0) continue;

          moved = true;
          const axis = overlapX <= overlapY ? "x" : "y";
          const rawDelta = axis === "x" ? rightCenter.x - leftCenter.x : rightCenter.y - leftCenter.y;
          const sign = rawDelta === 0 ? (hashId(`${left.id}:${right.id}`, axis === "x" ? 421 : 619) % 2 === 0 ? -1 : 1) : Math.sign(rawDelta);
          const push = Math.min(axis === "x" ? overlapX : overlapY, LIVE_COLLISION_MAX_PUSH) * LIVE_COLLISION_RELAX;
          const totalWeight = leftWeight + rightWeight;
          const leftPush = leftWeight === 0 ? 0 : (push * rightWeight) / totalWeight;
          const rightPush = rightWeight === 0 ? 0 : (push * leftWeight) / totalWeight;

          if (axis === "x") {
            if (leftWeight) left.x = (left.x ?? 0) - sign * leftPush;
            if (rightWeight) right.x = (right.x ?? 0) + sign * rightPush;
          } else {
            if (leftWeight) left.y = (left.y ?? 0) - sign * leftPush;
            if (rightWeight) right.y = (right.y ?? 0) + sign * rightPush;
          }
          if (leftWeight) {
            left.vx = 0;
            left.vy = 0;
          }
          if (rightWeight) {
            right.vx = 0;
            right.vy = 0;
          }
        }
      }
      if (!moved) break;
    }
  }

  const simulation: Simulation<SimNode, SimLink> = forceSimulation(nodes)
    .force("charge", forceManyBody<SimNode>().strength(chargeStrength()))
    .force(
      "link",
      forceLink<SimNode, SimLink>(buildLinks(input))
        .id((node) => node.id)
        .distance((link) => LINK_DISTANCE[link.kind])
        .strength((link) => linkStrength(link)),
    )
    .force("collide", forceCollide<SimNode>().radius((node) => collideRadius(node.box)))
    .force(
      "x",
      forceX<SimNode>((node) => anchorCenter(node)?.x ?? node.x ?? 0).strength((node) => anchorPullStrength(node)),
    )
    .force(
      "y",
      forceY<SimNode>((node) => anchorCenter(node)?.y ?? node.y ?? 0).strength((node) => anchorPullStrength(node)),
    )
    .stop();

  function applyDragPins(): void {
    for (const node of nodes) {
      const drag = dragPins.get(node.id);
      if (drag) {
        node.fx = drag.x;
        node.fy = drag.y;
        node.x = drag.x;
        node.y = drag.y;
        node.vx = 0;
        node.vy = 0;
      } else if (seedLocks.has(node.id)) {
        const seed = seedLocks.get(node.id);
        node.fx = seed?.x ?? node.x ?? 0;
        node.fy = seed?.y ?? node.y ?? 0;
      } else if (!node.fixed) {
        node.fx = null;
        node.fy = null;
      }
    }
  }

  function positions(): Record<string, XY> {
    const out: Record<string, XY> = {};
    for (const node of nodes) out[node.id] = { x: node.x ?? 0, y: node.y ?? 0 };
    return out;
  }

  return {
    tick(): SettleTickResult {
      applyDragPins();
      if (live) {
        simulation.tick();
        applyOrbitStep();
        applyLivePrerequisitePull();
        applyLiveCollisions();
        return { alpha: simulation.alpha(), positions: positions() };
      }
      if (!live && simulation.alpha() <= SETTLE_ALPHA_MIN) {
        for (const node of nodes) {
          if (node.fx != null) {
            node.x = node.fx;
            node.vx = 0;
          }
          if (node.fy != null) {
            node.y = node.fy;
            node.vy = 0;
          }
        }
        return { alpha: simulation.alpha(), positions: positions() };
      }
      simulation.tick();
      applyOrbitStep();
      return { alpha: simulation.alpha(), positions: positions() };
    },
    reheat(alpha = 1): void {
      seedLocks.clear();
      simulation.alpha(live ? Math.min(alpha, LIVE_REHEAT_ALPHA) : alpha).alphaTarget(live ? LIVE_ALPHA_TARGET : 0).restart().stop();
    },
    setLive(nextLive): void {
      live = nextLive;
      if (nextLive) seedLocks.clear();
      refreshLinkStrength();
      refreshChargeStrength();
      simulation.alphaTarget(nextLive ? LIVE_ALPHA_TARGET : 0);
      if (nextLive) simulation.alpha(Math.min(Math.max(simulation.alpha(), LIVE_ALPHA_TARGET), LIVE_REHEAT_ALPHA));
      simulation.restart().stop();
    },
    setDragPin(id, pos): void {
      if (pos) {
        dragPins.set(id, pos);
        const prevAnchor = anchorById[id];
        if (prevAnchor) {
          translateAnchoredNodes(id, { x: pos.x - prevAnchor.x, y: pos.y - prevAnchor.y });
          anchorOverrides.set(id, pos);
          anchorById = { ...anchorById, [id]: pos };
        }
      } else {
        dragPins.delete(id);
      }
    },
    syncModel(next): void {
      const wasSettled = simulation.alpha() <= SETTLE_ALPHA_MIN;
      anchorById = { ...next.anchorById, ...Object.fromEntries(anchorOverrides) };
      const prevById = nodeById;
      nodes = next.nodes.map((node) => {
        const prev = prevById.get(node.id);
        const sim: SimNode = prev
          ? { ...prev, box: node.box, fixed: node.fixed, anchorId: node.anchorId, anchorIds: node.anchorIds }
          : {
              id: node.id,
              box: node.box,
              fixed: node.fixed,
              anchorId: node.anchorId,
              anchorIds: node.anchorIds,
              x: node.seed.x,
              y: node.seed.y,
            };
        if (!prev && !sim.fixed) seedLocks.set(sim.id, node.seed);
        if (sim.fixed) lockFixedToSeed(sim, anchorOverrides.get(sim.id) ?? node.seed);
        return sim;
      });
      nodeById = new Map(nodes.map((node) => [node.id, node]));
      simulation.nodes(nodes);
      linkForce()?.links(buildLinks(next));
      refreshLinkStrength();
      refreshChargeStrength();
      if (wasSettled) {
        simulation.alpha(0);
        for (const node of nodes) {
          node.vx = 0;
          node.vy = 0;
        }
      }
    },
    isSettled(): boolean {
      return simulation.alpha() <= SETTLE_ALPHA_MIN;
    },
    stop(): void {
      simulation.stop();
      simulation.nodes([]);
      dragPins.clear();
      anchorOverrides.clear();
      orbitStates.clear();
      seedLocks.clear();
    },
  };
}
