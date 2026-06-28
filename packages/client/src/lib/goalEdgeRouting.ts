export interface HandleBox {
  /** 节点可视框中心（已折算 offset） */
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface Rect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function rectOf(box: HandleBox): Rect {
  return {
    minX: box.x - box.width / 2,
    maxX: box.x + box.width / 2,
    minY: box.y - box.height / 2,
    maxY: box.y + box.height / 2,
  };
}

/** 线段 a→b 是否与矩形相交（Liang–Barsky 裁剪，含穿过内部）。 */
function segmentHitsRect(a: Point, b: Point, rect: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, a.x - rect.minX],
    [dx, rect.maxX - a.x],
    [-dy, a.y - rect.minY],
    [dy, rect.maxY - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false; // 平行于该边界且落在外侧
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

function crossings(a: Point, b: Point, obstacles: Rect[]): number {
  let count = 0;
  for (const rect of obstacles) {
    if (segmentHitsRect(a, b, rect)) count += 1;
  }
  return count;
}

export type NodeGeom = HandleBox;

export interface EdgeRouting {
  /** 弯曲强度=控制点沿连线法向偏移量(px) */
  bow: number;
  /** 弯向：连线法向的哪一侧 */
  bowSide: -1 | 1;
  /** source 端沿法向错开量(px，含符号) */
  sourceShift: number;
  /** target 端沿法向错开量(px，含符号) */
  targetShift: number;
}

export const CURVATURE = 0.25;
export const BASE_BOW = 14;
export const ZERO_ROUTING: EdgeRouting = { bow: 0, bowSide: 1, sourceShift: 0, targetShift: 0 };

/** 射线 center→towards 与中心矩形(±halfW,±halfH)边框的交点。 */
export function intersectBorder(center: Point, halfW: number, halfH: number, towards: Point): Point {
  const dx = towards.x - center.x;
  const dy = towards.y - center.y;
  if (dx === 0 && dy === 0) return { x: center.x, y: center.y };
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/** 自绘三次贝塞尔：端点=真实交点(+法向错开)，控制点沿真实方向延伸(+法向 bow)。 */
export function floatingEdgeGeometry(
  source: NodeGeom,
  target: NodeGeom,
  routing: EdgeRouting,
): { sx: number; sy: number; tx: number; ty: number; path: string } {
  const sc: Point = { x: source.x, y: source.y };
  const tc: Point = { x: target.x, y: target.y };
  const sHit = intersectBorder(sc, source.width / 2, source.height / 2, tc);
  const tHit = intersectBorder(tc, target.width / 2, target.height / 2, sc);
  const dx = tHit.x - sHit.x;
  const dy = tHit.y - sHit.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const nx = -uy;
  const ny = ux;
  const sx = sHit.x + nx * routing.sourceShift;
  const sy = sHit.y + ny * routing.sourceShift;
  const tx = tHit.x + nx * routing.targetShift;
  const ty = tHit.y + ny * routing.targetShift;
  const ctrlLen = CURVATURE * dist;
  const bow = routing.bow * routing.bowSide;
  const scx = sx + ux * ctrlLen + nx * bow;
  const scy = sy + uy * ctrlLen + ny * bow;
  const tcx = tx - ux * ctrlLen + nx * bow;
  const tcy = ty - uy * ctrlLen + ny * bow;
  const path = `M${sx},${sy} C${scx},${scy} ${tcx},${tcy} ${tx},${ty}`;
  return { sx, sy, tx, ty, path };
}

export const AVOID_BOW = 36;
export const MAX_BOW = 60;
export const PROBE = 60;
export const NEAR_ANGLE = 0.35;
export const SHIFT = 7;

export type RoutableEdge = { id: string; source: string; target: string; kind: string };

/** 单条 prerequisite 边的鼓包方向与强度。 */
function bowForEdge(source: NodeGeom, target: NodeGeom, obstacles: Rect[]): { bow: number; bowSide: -1 | 1 } {
  const a: Point = { x: source.x, y: source.y };
  const b: Point = { x: target.x, y: target.y };
  if (crossings(a, b, obstacles) === 0) return { bow: BASE_BOW, bowSide: 1 };

  const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / dist;
  const ny = (b.x - a.x) / dist;
  const mid: Point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const sideCrossings = (side: -1 | 1): number => {
    const m: Point = { x: mid.x + nx * PROBE * side, y: mid.y + ny * PROBE * side };
    return crossings(a, m, obstacles) + crossings(m, b, obstacles);
  };
  const bowSide: -1 | 1 = sideCrossings(1) <= sideCrossings(-1) ? 1 : -1;
  return { bow: Math.min(MAX_BOW, BASE_BOW + AVOID_BOW), bowSide };
}

/** 方位角(rad)：从 from 中心指向 to 中心。 */
function bearing(from: NodeGeom, to: NodeGeom): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** 两角的最小夹角(0..π)。 */
function angleGap(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

/** 为一节点上方向接近的"入/出"边按角色加切向错开。 */
function applyShifts(
  edges: ReadonlyArray<RoutableEdge>,
  nodeGeomById: Map<string, NodeGeom>,
  result: Map<string, EdgeRouting>,
): void {
  type Endpoint = { edgeId: string; role: "source" | "target"; bearing: number };
  const byNode = new Map<string, Endpoint[]>();
  for (const edge of edges) {
    if (edge.kind !== "prerequisite") continue;
    const s = nodeGeomById.get(edge.source);
    const t = nodeGeomById.get(edge.target);
    if (!s || !t) continue;
    let sourceArr = byNode.get(edge.source);
    if (!sourceArr) {
      sourceArr = [];
      byNode.set(edge.source, sourceArr);
    }
    sourceArr.push({ edgeId: edge.id, role: "source", bearing: bearing(s, t) });
    let targetArr = byNode.get(edge.target);
    if (!targetArr) {
      targetArr = [];
      byNode.set(edge.target, targetArr);
    }
    targetArr.push({ edgeId: edge.id, role: "target", bearing: bearing(t, s) });
  }
  for (const endpoints of byNode.values()) {
    for (const ep of endpoints) {
      const tooClose = endpoints.some(
        (other) => other !== ep && angleGap(other.bearing, ep.bearing) < NEAR_ANGLE,
      );
      if (!tooClose) continue;
      const routing = result.get(ep.edgeId);
      if (!routing) continue;
      const shift = ep.role === "target" ? SHIFT : -SHIFT;
      if (ep.role === "source") routing.sourceShift = shift;
      else routing.targetShift = shift;
    }
  }
}

/** 看全图为每条边算 routing：prerequisite 走绕障+错开，其余零 routing。 */
export function computeEdgeRoutings(
  edges: ReadonlyArray<RoutableEdge>,
  nodeGeomById: Map<string, NodeGeom>,
): Map<string, EdgeRouting> {
  const result = new Map<string, EdgeRouting>();
  for (const edge of edges) {
    const s = nodeGeomById.get(edge.source);
    const t = nodeGeomById.get(edge.target);
    if (edge.kind !== "prerequisite" || !s || !t) {
      result.set(edge.id, { ...ZERO_ROUTING });
      continue;
    }
    const obstacles: Rect[] = [];
    for (const [id, box] of nodeGeomById) {
      if (id !== edge.source && id !== edge.target) obstacles.push(rectOf(box));
    }
    const { bow, bowSide } = bowForEdge(s, t, obstacles);
    result.set(edge.id, { bow, bowSide, sourceShift: 0, targetShift: 0 });
  }
  applyShifts(edges, nodeGeomById, result);
  return result;
}
