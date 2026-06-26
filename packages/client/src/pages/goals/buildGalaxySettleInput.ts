import type { XY } from "../../lib/goalGalaxyLayout.js";
import type { GalaxyModel } from "../../lib/goalGalaxyModel.js";
import type { GalaxySettleInput, SettleLinkInput, SettleNodeInput } from "../../lib/goalGalaxySettle.js";
import type { GoalGraphNodeBox } from "../../lib/goalGraphLayout.js";

const DEFAULT_BOX: GoalGraphNodeBox = { width: 180, height: 56 };

export function buildGalaxySettleInput(args: {
  model: GalaxyModel;
  seedPositions: Record<string, XY>;
  boxes: Record<string, GoalGraphNodeBox>;
  pinnedMemberIds: ReadonlySet<string>;
  anchorCanvasById: Record<string, XY>;
}): GalaxySettleInput {
  const { model, seedPositions, boxes, anchorCanvasById } = args;
  const seedOf = (id: string): XY => seedPositions[id] ?? { x: 0, y: 0 };
  const anchorOf = (id: string): XY => seedPositions[id] ?? anchorCanvasById[id] ?? { x: 0, y: 0 };
  const boxOf = (id: string): GoalGraphNodeBox => boxes[id] ?? DEFAULT_BOX;

  const nodes: SettleNodeInput[] = [];
  const anchorById: Record<string, XY> = { ...anchorCanvasById };
  for (const star of model.stars) {
    nodes.push({ id: star.nodeId, seed: seedOf(star.nodeId), box: boxOf(star.nodeId), fixed: true });
    anchorById[star.nodeId] = anchorOf(star.nodeId);
  }

  for (const node of model.nodes) {
    const single = node.anchorIds.length === 1;
    nodes.push({
      id: node.id,
      seed: seedOf(node.id),
      box: boxOf(node.id),
      fixed: false,
      anchorId: single ? node.anchorIds[0] : undefined,
      anchorIds: [...node.anchorIds],
    });
  }

  const links: SettleLinkInput[] = model.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    kind: edge.kind === "prerequisite" ? "prerequisite" : "tether",
  }));
  for (const node of model.nodes) {
    if (node.anchorIds.length < 2) continue;
    for (const anchorId of node.anchorIds) {
      links.push({ source: anchorId, target: node.id, kind: "bridge" });
    }
  }

  return { nodes, links, anchorById };
}
