import { describe, expect, it } from "vitest";
import { createGalaxySettleSim, type GalaxySettleInput } from "./goalGalaxySettle.js";

const BOX = { width: 180, height: 56 };
const TASK_LABEL_BOX = { width: 228, height: 48, offsetX: 94 };

function angularDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function baseInput(): GalaxySettleInput {
  return {
    nodes: [
      { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
      { id: "task:a", seed: { x: 40, y: 0 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      { id: "task:b", seed: { x: 45, y: 4 }, box: BOX, fixed: false, anchorId: "goal:g1" },
    ],
    links: [
      { source: "goal:g1", target: "task:a", kind: "tether" },
      { source: "goal:g1", target: "task:b", kind: "tether" },
    ],
    anchorById: { "goal:g1": { x: 0, y: 0 } },
  };
}

function runToRest(input: GalaxySettleInput, maxTicks = 600) {
  const sim = createGalaxySettleSim(input);
  let result = sim.tick();
  let ticks = 1;
  while (!sim.isSettled() && ticks < maxTicks) {
    result = sim.tick();
    ticks += 1;
  }
  sim.stop();
  return { result, ticks };
}

describe("createGalaxySettleSim", () => {
  it("never moves a fixed node from its seed", () => {
    const { result } = runToRest(baseInput());
    expect(result.positions["goal:g1"]).toEqual({ x: 0, y: 0 });
  });

  it("cools to rest (isSettled) within a bounded number of ticks", () => {
    const { ticks } = runToRest(baseInput());
    expect(ticks).toBeLessThan(600);
  });

  it("pushes overlapping seeds apart so two members no longer overlap", () => {
    const { result } = runToRest(baseInput());
    const a = result.positions["task:a"];
    const b = result.positions["task:b"];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    expect(dist).toBeGreaterThan(BOX.width / 2);
  });

  it("is deterministic: same input settles to the same positions", () => {
    const first = runToRest(baseInput()).result.positions;
    const second = runToRest(baseInput()).result.positions;
    expect(second).toEqual(first);
  });

  it("pins a dragged node to the cursor while a drag pin is set", () => {
    const sim = createGalaxySettleSim(baseInput());
    sim.setDragPin("task:a", { x: 300, y: -200 });
    sim.reheat();
    for (let i = 0; i < 50; i += 1) sim.tick();
    const final = sim.tick();
    sim.stop();
    expect(final.positions["task:a"]).toEqual({ x: 300, y: -200 });
  });

  it("keeps a dragged live anchor through later model syncs", () => {
    const input: GalaxySettleInput = {
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:a", seed: { x: 160, y: 0 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [{ source: "goal:g1", target: "task:a", kind: "tether" }],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    };
    const sim = createGalaxySettleSim(input);
    sim.setLive(true);
    sim.setDragPin("goal:g1", { x: 300, y: -120 });
    expect(sim.tick().positions["goal:g1"]).toEqual({ x: 300, y: -120 });
    sim.setDragPin("goal:g1", null);
    sim.syncModel(input);
    const afterSync = sim.tick();
    sim.stop();

    expect(afterSync.positions["goal:g1"]).toEqual({ x: 300, y: -120 });
  });

  it("uses a moved fixed anchor node as the live orbit center", () => {
    const input: GalaxySettleInput = {
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 300 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:a", seed: { x: 0, y: 40 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [{ source: "goal:g1", target: "task:a", kind: "tether" }],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    };
    const sim = createGalaxySettleSim(input);
    sim.setLive(true);
    const before = sim.tick().positions["task:a"];
    for (let i = 0; i < 100; i += 1) sim.tick();
    const after = sim.tick().positions["task:a"];
    sim.stop();

    expect(Math.hypot(after.x, after.y - 300)).toBeLessThan(Math.hypot(before.x, before.y - 300));
  });

  it("orbits members around a dragged live anchor after release", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:a", seed: { x: 160, y: 0 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [{ source: "goal:g1", target: "task:a", kind: "tether" }],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    sim.setLive(true);
    sim.setDragPin("goal:g1", { x: 300, y: -120 });
    sim.tick();
    sim.setDragPin("goal:g1", null);
    const before = sim.tick().positions["task:a"];
    for (let i = 0; i < 220; i += 1) sim.tick();
    const after = sim.tick().positions["task:a"];
    sim.stop();

    const beforeAngle = Math.atan2(before.y + 120, before.x - 300);
    const afterAngle = Math.atan2(after.y + 120, after.x - 300);
    expect(Math.abs(afterAngle - beforeAngle)).toBeGreaterThan(0.05);
    expect(Math.hypot(after.x - 300, after.y + 120)).toBeLessThan(320);
  });

  it("reheat gives settled unfixed nodes a deterministic kick", () => {
    const sim = createGalaxySettleSim(baseInput());
    while (!sim.isSettled()) sim.tick();
    const settled = sim.tick().positions["task:a"];

    sim.reheat();
    const reheated = sim.tick().positions["task:a"];
    sim.stop();

    expect(reheated).not.toEqual(settled);
  });

  it("adds orbital drift around a member anchor while reheated", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:a", seed: { x: 160, y: 0 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [{ source: "goal:g1", target: "task:a", kind: "tether" }],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    const before = sim.tick().positions["task:a"];
    for (let i = 0; i < 8; i += 1) sim.tick();
    const after = sim.tick().positions["task:a"];
    sim.stop();

    expect(Math.atan2(after.y, after.x)).toBeGreaterThan(Math.atan2(before.y, before.x));
  });

  it("keeps ticking below the normal settle threshold while live mode is on", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:a", seed: { x: 160, y: 0 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [{ source: "goal:g1", target: "task:a", kind: "tether" }],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    while (!sim.isSettled()) sim.tick();
    sim.setLive(true);
    const before = sim.tick().positions["task:a"];
    for (let i = 0; i < 8; i += 1) sim.tick();
    const after = sim.tick().positions["task:a"];
    sim.stop();

    expect(after).not.toEqual(before);
  });

  it("starts live mode from the static seeds without an initial jump", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:a", seed: { x: 160, y: 0 }, box: BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:b", seed: { x: 0, y: 160 }, box: BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:c", seed: { x: -160, y: 0 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [
        { source: "goal:g1", target: "task:a", kind: "tether" },
        { source: "goal:g1", target: "task:b", kind: "tether" },
        { source: "goal:g1", target: "task:c", kind: "tether" },
      ],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });

    sim.setLive(true);
    const first = sim.tick().positions;
    sim.stop();

    expect(first["goal:g1"]).toEqual({ x: 0, y: 0 });
    expect(Math.hypot(first["task:a"].x - 160, first["task:a"].y)).toBeLessThan(5);
    expect(Math.hypot(first["task:b"].x, first["task:b"].y - 160)).toBeLessThan(5);
    expect(Math.hypot(first["task:c"].x + 160, first["task:c"].y)).toBeLessThan(5);
  });

  it("keeps nodes added after an empty live start moving from their static seeds", () => {
    const sim = createGalaxySettleSim({ nodes: [], links: [], anchorById: {} });
    sim.setLive(true);
    sim.tick();

    sim.syncModel({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:a", seed: { x: 160, y: 0 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [{ source: "goal:g1", target: "task:a", kind: "tether" }],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    const first = sim.tick().positions["task:a"];
    for (let i = 0; i < 80; i += 1) sim.tick();
    const after = sim.tick().positions["task:a"];
    sim.stop();

    expect(first).toEqual({ x: 160, y: 0 });
    expect(Math.hypot(after.x - first.x, after.y - first.y)).toBeGreaterThan(0.5);
  });

  it("keeps live orbital drift slow and non-uniform", () => {
    const sim = createGalaxySettleSim(baseInput());
    while (!sim.isSettled()) sim.tick();
    sim.setLive(true);
    const before = sim.tick().positions;
    for (let i = 0; i < 40; i += 1) sim.tick();
    const after = sim.tick().positions;
    sim.stop();

    const angleDeltaA = Math.abs(Math.atan2(after["task:a"].y, after["task:a"].x) - Math.atan2(before["task:a"].y, before["task:a"].x));
    const angleDeltaB = Math.abs(Math.atan2(after["task:b"].y, after["task:b"].x) - Math.atan2(before["task:b"].y, before["task:b"].x));
    const distanceA = Math.hypot(after["task:a"].x, after["task:a"].y);
    const distanceB = Math.hypot(after["task:b"].x, after["task:b"].y);

    expect(angleDeltaA).toBeGreaterThan(0.005);
    expect(angleDeltaA).toBeLessThan(0.12);
    expect(Math.abs(angleDeltaA - angleDeltaB)).toBeGreaterThan(0.002);
    expect(distanceA).toBeLessThan(260);
    expect(distanceB).toBeLessThan(260);
  });

  it("keeps members around the same live anchor moving in the same orbital direction", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:first", seed: { x: 170, y: -40 }, box: BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:second", seed: { x: 120, y: 120 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [
        { source: "goal:g1", target: "task:first", kind: "tether" },
        { source: "goal:g1", target: "task:second", kind: "tether" },
      ],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    sim.setLive(true);
    for (let i = 0; i < 300; i += 1) sim.tick();
    const before = sim.tick().positions;
    for (let i = 0; i < 80; i += 1) sim.tick();
    const after = sim.tick().positions;
    sim.stop();

    const firstDelta = Math.atan2(after["task:first"].y, after["task:first"].x) - Math.atan2(before["task:first"].y, before["task:first"].x);
    const secondDelta = Math.atan2(after["task:second"].y, after["task:second"].x) - Math.atan2(before["task:second"].y, before["task:second"].x);
    expect(Math.sign(firstDelta)).toBe(Math.sign(secondDelta));
    expect(Math.sign(firstDelta)).not.toBe(0);
  });

  it("gives same-anchor live members visibly different angular speeds", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:a", seed: { x: 180, y: -20 }, box: BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:b", seed: { x: 70, y: 175 }, box: BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:c", seed: { x: -190, y: 40 }, box: BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:d", seed: { x: -40, y: -210 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [
        { source: "goal:g1", target: "task:a", kind: "tether" },
        { source: "goal:g1", target: "task:b", kind: "tether" },
        { source: "goal:g1", target: "task:c", kind: "tether" },
        { source: "goal:g1", target: "task:d", kind: "tether" },
      ],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    sim.setLive(true);
    for (let i = 0; i < 120; i += 1) sim.tick();
    const before = sim.tick().positions;
    for (let i = 0; i < 100; i += 1) sim.tick();
    const after = sim.tick().positions;
    sim.stop();

    const deltas = ["task:a", "task:b", "task:c", "task:d"].map(
      (id) => angularDelta(Math.atan2(before[id].y, before[id].x), Math.atan2(after[id].y, after[id].x)),
    );
    const magnitudes = deltas.map(Math.abs).sort((left, right) => left - right);
    const signs = deltas.map(Math.sign);
    expect(signs[0]).not.toBe(0);
    expect(signs.every((sign) => sign === signs[0])).toBe(true);
    expect(magnitudes[3] - magnitudes[0]).toBeGreaterThan(0.12);
  });

  it("keeps d3 forces active while live orbit nudging runs", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:far", seed: { x: 360, y: 0 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [{ source: "goal:g1", target: "task:far", kind: "tether" }],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    sim.setLive(true);
    const alphaBefore = sim.tick().alpha;
    for (let i = 0; i < 8; i += 1) sim.tick();
    const alphaAfter = sim.tick().alpha;
    sim.stop();

    expect(alphaAfter).toBeLessThan(alphaBefore);
  });

  it("lets prerequisite-linked live members keep drifting independently", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:slow", seed: { x: 150, y: -40 }, box: BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:fast", seed: { x: -40, y: 150 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [
        { source: "goal:g1", target: "task:slow", kind: "tether" },
        { source: "goal:g1", target: "task:fast", kind: "tether" },
        { source: "task:slow", target: "task:fast", kind: "prerequisite" },
      ],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    while (!sim.isSettled()) sim.tick();
    sim.setLive(true);
    const before = sim.tick().positions;
    for (let i = 0; i < 120; i += 1) sim.tick();
    const after = sim.tick().positions;
    sim.stop();

    const slowMove = Math.hypot(after["task:slow"].x - before["task:slow"].x, after["task:slow"].y - before["task:slow"].y);
    const fastMove = Math.hypot(after["task:fast"].x - before["task:fast"].x, after["task:fast"].y - before["task:fast"].y);
    const beforePairAngle = Math.atan2(
      before["task:fast"].y - before["task:slow"].y,
      before["task:fast"].x - before["task:slow"].x,
    );
    const afterPairAngle = Math.atan2(
      after["task:fast"].y - after["task:slow"].y,
      after["task:fast"].x - after["task:slow"].x,
    );

    expect(Math.min(slowMove, fastMove)).toBeGreaterThan(12);
    expect(Math.abs(afterPairAngle - beforePairAngle)).toBeGreaterThan(0.05);
  });

  it("keeps live prerequisite links as a weak physical relationship", () => {
    const linked: GalaxySettleInput = {
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:left", seed: { x: -260, y: 160 }, box: BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:right", seed: { x: 260, y: -160 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [
        { source: "goal:g1", target: "task:left", kind: "tether" },
        { source: "goal:g1", target: "task:right", kind: "tether" },
        { source: "task:left", target: "task:right", kind: "prerequisite" },
      ],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    };
    const unlinked: GalaxySettleInput = {
      ...linked,
      links: linked.links.filter((link) => link.kind !== "prerequisite"),
    };
    const run = (input: GalaxySettleInput) => {
      const sim = createGalaxySettleSim(input);
      sim.setLive(true);
      for (let i = 0; i < 120; i += 1) sim.tick();
      const positions = sim.tick().positions;
      sim.stop();
      return Math.hypot(positions["task:right"].x - positions["task:left"].x, positions["task:right"].y - positions["task:left"].y);
    };

    expect(run(linked)).toBeLessThan(run(unlinked) - 8);
  });

  it("applies live prerequisite pull mostly when linked nodes are far apart without pushing near links outward", () => {
    const run = (rightSeed: { x: number; y: number }, linked: boolean) => {
      const sim = createGalaxySettleSim({
        nodes: [
          { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
          { id: "task:left", seed: { x: -80, y: 120 }, box: BOX, fixed: false, anchorId: "goal:g1" },
          { id: "task:right", seed: rightSeed, box: BOX, fixed: false, anchorId: "goal:g1" },
        ],
        links: [
          { source: "goal:g1", target: "task:left", kind: "tether" },
          { source: "goal:g1", target: "task:right", kind: "tether" },
          ...(linked ? [{ source: "task:left", target: "task:right", kind: "prerequisite" as const }] : []),
        ],
        anchorById: { "goal:g1": { x: 0, y: 0 } },
      });
      sim.setLive(true);
      const before = sim.tick().positions;
      for (let i = 0; i < 80; i += 1) sim.tick();
      const after = sim.tick().positions;
      sim.stop();
      const beforeDistance = Math.hypot(before["task:right"].x - before["task:left"].x, before["task:right"].y - before["task:left"].y);
      const afterDistance = Math.hypot(after["task:right"].x - after["task:left"].x, after["task:right"].y - after["task:left"].y);
      return { beforeDistance, afterDistance, pull: beforeDistance - afterDistance };
    };

    const nearLinked = run({ x: 10, y: 150 }, true);
    const nearUnlinked = run({ x: 10, y: 150 }, false);
    const farLinked = run({ x: 360, y: -180 }, true);
    const farUnlinked = run({ x: 360, y: -180 }, false);

    expect(farLinked.pull).toBeGreaterThan(farUnlinked.pull + 30);
    expect(nearLinked.afterDistance).toBeLessThanOrEqual(nearUnlinked.afterDistance + 2);
  });

  it("keeps live member label boxes from collapsing into a unreadable pile", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:one", seed: { x: 118, y: -8 }, box: TASK_LABEL_BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:two", seed: { x: 124, y: -4 }, box: TASK_LABEL_BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:three", seed: { x: 130, y: 0 }, box: TASK_LABEL_BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [
        { source: "goal:g1", target: "task:one", kind: "tether" },
        { source: "goal:g1", target: "task:two", kind: "tether" },
        { source: "goal:g1", target: "task:three", kind: "tether" },
      ],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    sim.setLive(true);
    for (let i = 0; i < 8; i += 1) sim.tick();
    const positions = sim.tick().positions;
    sim.stop();

    const ids = ["task:one", "task:two", "task:three"];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const left = positions[ids[i]];
        const right = positions[ids[j]];
        const centerDx = Math.abs(left.x + TASK_LABEL_BOX.offsetX - (right.x + TASK_LABEL_BOX.offsetX));
        const centerDy = Math.abs(left.y - right.y);
        expect(centerDx > TASK_LABEL_BOX.width * 0.65 || centerDy > TASK_LABEL_BOX.height * 0.8).toBe(true);
      }
    }
  });

  it("keeps a live goal system visually compact instead of drifting into empty space", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:north", seed: { x: 80, y: -430 }, box: BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:east", seed: { x: 480, y: 70 }, box: BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:south", seed: { x: -40, y: 390 }, box: BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:west", seed: { x: -460, y: -80 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [
        { source: "goal:g1", target: "task:north", kind: "tether" },
        { source: "goal:g1", target: "task:east", kind: "tether" },
        { source: "goal:g1", target: "task:south", kind: "tether" },
        { source: "goal:g1", target: "task:west", kind: "tether" },
      ],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    sim.setLive(true);
    const before = sim.tick().positions;
    for (let i = 0; i < 180; i += 1) sim.tick();
    const after = sim.tick().positions;
    sim.stop();

    const ids = ["task:north", "task:east", "task:south", "task:west"];
    const beforeAverageRadius = ids.reduce((sum, id) => sum + Math.hypot(before[id].x, before[id].y), 0) / ids.length;
    const afterRadii = ids.map((id) => Math.hypot(after[id].x, after[id].y));
    const afterAverageRadius = afterRadii.reduce((sum, radius) => sum + radius, 0) / afterRadii.length;

    expect(afterAverageRadius).toBeLessThan(beforeAverageRadius - 120);
    expect(Math.max(...afterRadii)).toBeLessThan(320);
  });

  it("pulls far live members back toward their anchor", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:far", seed: { x: 420, y: 0 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [{ source: "goal:g1", target: "task:far", kind: "tether" }],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    sim.setLive(true);
    const before = sim.tick().positions["task:far"];
    for (let i = 0; i < 80; i += 1) sim.tick();
    const after = sim.tick().positions["task:far"];
    sim.stop();

    expect(Math.hypot(after.x, after.y)).toBeLessThan(Math.hypot(before.x, before.y));
  });

  it("orbits bridge members around the live center of their anchors", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: -220, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "goal:g2", seed: { x: 220, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        {
          id: "task:bridge",
          seed: { x: 0, y: 420 },
          box: BOX,
          fixed: false,
          anchorIds: ["goal:g1", "goal:g2"],
        },
      ],
      links: [
        { source: "goal:g1", target: "task:bridge", kind: "bridge" },
        { source: "goal:g2", target: "task:bridge", kind: "bridge" },
      ],
      anchorById: { "goal:g1": { x: -220, y: 0 }, "goal:g2": { x: 220, y: 0 } },
    });
    sim.setLive(true);
    const before = sim.tick().positions["task:bridge"];
    for (let i = 0; i < 100; i += 1) sim.tick();
    const after = sim.tick().positions["task:bridge"];
    sim.stop();

    expect(Math.hypot(after.x, after.y)).toBeLessThan(Math.hypot(before.x, before.y) - 40);
    expect(Math.abs(Math.atan2(after.y, after.x) - Math.atan2(before.y, before.x))).toBeGreaterThan(0.02);
  });

  it("makes live anchor pull scale more with distance than per-node randomness", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:near", seed: { x: 180, y: 0 }, box: BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:far", seed: { x: 420, y: 0 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [
        { source: "goal:g1", target: "task:near", kind: "tether" },
        { source: "goal:g1", target: "task:far", kind: "tether" },
      ],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    sim.setLive(true);
    const before = sim.tick().positions;
    for (let i = 0; i < 80; i += 1) sim.tick();
    const after = sim.tick().positions;
    sim.stop();

    const nearPull = Math.hypot(before["task:near"].x, before["task:near"].y) - Math.hypot(after["task:near"].x, after["task:near"].y);
    const farPull = Math.hypot(before["task:far"].x, before["task:far"].y) - Math.hypot(after["task:far"].x, after["task:far"].y);
    expect(farPull).toBeGreaterThan(nearPull * 1.8);
  });

  it("keeps live members in varied bands while pulling far members inward", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:inner", seed: { x: 120, y: -30 }, box: BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:middle", seed: { x: -210, y: 80 }, box: BOX, fixed: false, anchorId: "goal:g1" },
        { id: "task:outer", seed: { x: 340, y: 110 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [
        { source: "goal:g1", target: "task:inner", kind: "tether" },
        { source: "goal:g1", target: "task:middle", kind: "tether" },
        { source: "goal:g1", target: "task:outer", kind: "tether" },
      ],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    sim.setLive(true);
    const before = sim.tick().positions;
    for (let i = 0; i < 220; i += 1) sim.tick();
    const positions = sim.tick().positions;
    sim.stop();

    const radii = ["task:inner", "task:middle", "task:outer"]
      .map((id) => Math.hypot(positions[id].x, positions[id].y))
      .sort((left, right) => left - right);
    expect(Math.hypot(positions["task:outer"].x, positions["task:outer"].y)).toBeLessThan(
      Math.hypot(before["task:outer"].x, before["task:outer"].y) - 40,
    );
    expect(radii[2] - radii[0]).toBeGreaterThan(45);
  });

  it("varies a live member's angular speed over time", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:wander", seed: { x: 160, y: 0 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [{ source: "goal:g1", target: "task:wander", kind: "tether" }],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    sim.setLive(true);
    const first = sim.tick().positions["task:wander"];
    for (let i = 0; i < 30; i += 1) sim.tick();
    const middle = sim.tick().positions["task:wander"];
    for (let i = 0; i < 30; i += 1) sim.tick();
    const last = sim.tick().positions["task:wander"];
    sim.stop();

    const firstDelta = Math.atan2(middle.y, middle.x) - Math.atan2(first.y, first.x);
    const secondDelta = Math.atan2(last.y, last.x) - Math.atan2(middle.y, middle.x);
    expect(Math.abs(firstDelta - secondDelta)).toBeGreaterThan(0.0005);
  });

  it("changes live angular speed smoothly without tug spikes", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:smooth", seed: { x: 170, y: 20 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [{ source: "goal:g1", target: "task:smooth", kind: "tether" }],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    sim.setLive(true);
    for (let i = 0; i < 300; i += 1) sim.tick();

    const angles: number[] = [];
    for (let i = 0; i < 120; i += 1) {
      const position = sim.tick().positions["task:smooth"];
      angles.push(Math.atan2(position.y, position.x));
    }
    sim.stop();

    const deltas = angles.slice(1).map((angle, index) => angle - angles[index]);
    const adjacentChanges = deltas.slice(1).map((delta, index) => Math.abs(delta - deltas[index]));
    expect(Math.max(...adjacentChanges)).toBeLessThan(0.0035);
  });

  it("keeps early live direction stable long enough to form an arc", () => {
    const sim = createGalaxySettleSim({
      nodes: [
        { id: "goal:g1", seed: { x: 0, y: 0 }, box: { width: 220, height: 80 }, fixed: true },
        { id: "task:wander", seed: { x: 160, y: 0 }, box: BOX, fixed: false, anchorId: "goal:g1" },
      ],
      links: [{ source: "goal:g1", target: "task:wander", kind: "tether" }],
      anchorById: { "goal:g1": { x: 0, y: 0 } },
    });
    sim.setLive(true);
    const angles: number[] = [];
    for (let i = 0; i < 140; i += 1) {
      const position = sim.tick().positions["task:wander"];
      angles.push(Math.atan2(position.y, position.x));
    }
    sim.stop();

    const deltas = angles.slice(1).map((angle, index) => angle - angles[index]);
    const meaningful = deltas.filter((delta) => Math.abs(delta) > 0.0002);
    const firstSign = Math.sign(meaningful[0] ?? 0);
    const reverseCount = meaningful.filter((delta) => Math.sign(delta) !== firstSign).length;
    const totalArc = Math.abs(angles.at(-1) ?? 0) - Math.abs(angles[0] ?? 0);

    expect(firstSign).not.toBe(0);
    expect(reverseCount).toBe(0);
    expect(Math.abs(totalArc)).toBeGreaterThan(0.05);
  });

  it("syncModel adds a new node at its seed without reheating existing nodes", () => {
    const sim = createGalaxySettleSim(baseInput());
    while (!sim.isSettled()) sim.tick();
    const settledA = sim.tick().positions["task:a"];

    const grown = baseInput();
    grown.nodes.push({ id: "task:c", seed: { x: 999, y: 999 }, box: BOX, fixed: false, anchorId: "goal:g1" });
    grown.links.push({ source: "goal:g1", target: "task:c", kind: "tether" });
    sim.syncModel(grown);
    const afterSync = sim.tick();
    sim.stop();

    expect(afterSync.positions["task:c"]).toEqual({ x: 999, y: 999 });
    expect(afterSync.positions["task:a"].x).toBeCloseTo(settledA.x, 1);
    expect(afterSync.positions["task:a"].y).toBeCloseTo(settledA.y, 1);
  });

  it("syncModel moves an existing fixed node to its updated seed", () => {
    const sim = createGalaxySettleSim(baseInput());
    while (!sim.isSettled()) sim.tick();

    const moved = baseInput();
    moved.nodes = moved.nodes.map((node) =>
      node.id === "goal:g1" ? { ...node, seed: { x: 120, y: -80 } } : node,
    );
    moved.anchorById = { "goal:g1": { x: 120, y: -80 } };
    sim.syncModel(moved);
    const afterSync = sim.tick();
    sim.stop();

    expect(afterSync.positions["goal:g1"]).toEqual({ x: 120, y: -80 });
  });
});
