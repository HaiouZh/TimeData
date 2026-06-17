// 镜像 index.css @theme 的 --color-data-*（深色单主题，值不漂移；唯一事实源仍是 token）。
// recharts 的 stroke/fill/tick.fill 是 SVG presentation 属性，不解析 var()，故用 JS 常量。
export const DATA_PALETTE = {
  blue: "#4f9bf5",
  teal: "#2dd4bf",
  green: "#34d399",
  amber: "#fbbf24",
  red: "#f87171",
  purple: "#a78bfa",
} as const;

export type DataColor = (typeof DATA_PALETTE)[keyof typeof DATA_PALETTE];

// chrome：镜像中性 token（grid=--color-border, tick=--color-ink-3, legend=--color-ink-2）
export const CHART_CHROME = {
  grid: "#2b344e",
  tick: "#8b94a8",
  legend: "#aab4c8",
  reference: "#8b94a8",
} as const;

// 碰撞回退的固定取色顺序
const PALETTE_ORDER: DataColor[] = [
  DATA_PALETTE.blue,
  DATA_PALETTE.teal,
  DATA_PALETTE.green,
  DATA_PALETTE.amber,
  DATA_PALETTE.red,
  DATA_PALETTE.purple,
];

// 指标前缀 → 语义色（与 lib/healthBlocks/summary.ts 的分类同源）
function semanticColor(metricId: string): DataColor {
  if (metricId.startsWith("sleep.")) return DATA_PALETTE.green;
  if (metricId.startsWith("hrv.")) return DATA_PALETTE.teal;
  if (metricId.startsWith("heart_rate.")) return DATA_PALETTE.red;
  if (metricId.startsWith("stress.")) return DATA_PALETTE.amber;
  if (metricId.startsWith("run.")) return DATA_PALETTE.blue;
  return DATA_PALETTE.blue;
}

// 取色：优先语义色；若已被同图占用，退到 PALETTE_ORDER 首个未占色（全占则重复语义色）。
// claimed 原地记录已用色，调用方对同一张图复用同一个 Set。
export function metricColor(metricId: string, claimed: Set<string>): DataColor {
  const preferred = semanticColor(metricId);
  const chosen = claimed.has(preferred)
    ? (PALETTE_ORDER.find((c) => !claimed.has(c)) ?? preferred)
    : preferred;
  claimed.add(chosen);
  return chosen;
}
