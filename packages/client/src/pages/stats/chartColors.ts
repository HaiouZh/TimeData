// chrome：镜像 index.css @theme 的中性 token（grid=--color-border, tick=--color-ink-3,
// legend=--color-ink-2, tooltip 背/边/字=--color-surface-elevated/--color-border/--color-ink,
// shadow=--shadow-elev2, cursor=--color-accent）。深色单主题，值不漂移；唯一事实源仍是 token。
// recharts 的 stroke/fill/tick.fill 是 SVG presentation 属性，不解析 var()，故用 JS 常量镜像。
// 数据序列本身不在这里取色：InsightCharts 用用户分类色（item.color），见 docs/evergreen/stats-insights.md。
export const CHART_CHROME = {
  grid: "#2b344e",
  tick: "#8b94a8",
  legend: "#aab4c8",
  reference: "#8b94a8",
  tooltipBg: "#1b2336",
  tooltipBorder: "#2b344e",
  tooltipText: "#e8edf6",
  tooltipShadow: "0 8px 30px rgba(0,0,0,.4)",
  cursor: "#4f9bf5",
} as const;
