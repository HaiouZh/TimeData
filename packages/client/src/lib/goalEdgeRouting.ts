export type EdgeHandleSide = "left" | "right" | "top" | "bottom";

export interface HandleBox {
  /** 节点可视框中心（已折算 offset） */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeHandleChoice {
  source: EdgeHandleSide;
  target: EdgeHandleSide;
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

const SIDES: readonly EdgeHandleSide[] = ["top", "right", "bottom", "left"];

/** 现状选口：只看两端相对位置，横向错开走左右口、纵向错开走上下口。 */
function baseSides(source: HandleBox, target: HandleBox): EdgeHandleChoice {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { source: "right", target: "left" } : { source: "left", target: "right" };
  }
  return dy >= 0 ? { source: "bottom", target: "top" } : { source: "top", target: "bottom" };
}

function handlePoint(box: HandleBox, side: EdgeHandleSide): Point {
  switch (side) {
    case "left":
      return { x: box.x - box.width / 2, y: box.y };
    case "right":
      return { x: box.x + box.width / 2, y: box.y };
    case "top":
      return { x: box.x, y: box.y - box.height / 2 };
    case "bottom":
      return { x: box.x, y: box.y + box.height / 2 };
  }
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

function segLength(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * 为一条线选出入口：先看现状选口是否穿过别的节点；不穿就保持现状（不无谓改线），
 * 穿了就枚举四向口对，选穿到的节点最少、并列时线段最短的那对。
 */
export function chooseEdgeHandleSides(
  source: HandleBox,
  target: HandleBox,
  obstacles: HandleBox[],
): EdgeHandleChoice {
  const base = baseSides(source, target);
  if (obstacles.length === 0) return base;

  const rects = obstacles.map(rectOf);
  const baseHit = crossings(handlePoint(source, base.source), handlePoint(target, base.target), rects);
  if (baseHit === 0) return base;

  let best = base;
  let bestCrossings = baseHit;
  let bestLength = segLength(handlePoint(source, base.source), handlePoint(target, base.target));
  for (const s of SIDES) {
    for (const t of SIDES) {
      const a = handlePoint(source, s);
      const b = handlePoint(target, t);
      const c = crossings(a, b, rects);
      const len = segLength(a, b);
      if (c < bestCrossings || (c === bestCrossings && len < bestLength)) {
        best = { source: s, target: t };
        bestCrossings = c;
        bestLength = len;
      }
    }
  }
  return best;
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
