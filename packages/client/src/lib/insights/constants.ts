// 洞察计算可调常量。集中于此便于调参与测试（见基线校准笔记 C1~C5）。
export const INSIGHT_CONSTANTS = {
  // 会话合并：同父分类、相邻空隙 <= 该分钟数合并为一段。真实数据 3/5min 无差异，取 3。
  sessionMergeToleranceMin: 3,
  // 噪声会话下限：短于此的会话在分位统计中忽略。真实数据无 <1min 条目，保留护栏。
  minSessionMin: 1,
  // 个人基线窗口（天）。实际取 min(窗口, 现有数据天数)。
  baselineWindowDays: 90,
  // 超长记录：排除睡眠后，时长 >= 个人 P95 且 >= floor 才报。
  overlongPercentile: 0.95,
  overlongFloorMin: 180,
  // 长空白：清醒空档样本 >= minSample 时用 P75，否则回退固定 fallback。
  longGapPercentile: 0.75,
  longGapMinSample: 10,
  longGapFallbackMin: 90,
  // 通常睡眠时段（本地分钟 of day），用于「异常时段活动」判定与排除睡眠空档。23:00~07:00。
  sleepWindowStartMin: 23 * 60,
  sleepWindowEndMin: 7 * 60,
  // —— 趋势（第三期）——
  // 上升/下降榜各取前 N。真实数据父分类 5 个、前三占主体（见趋势校准 T3）。
  trendTopN: 3,
  // 上期可比最少「有数据天数」。低于此则环比退化为 noBaseline（仅显示绝对投入）。
  // 校准 T1：近7天上期 7/7 远超阈值，近30/90天上期 0/N 必然不足 → 取 3 放行近7天、拦空上期。
  trendPrevMinDaysWithData: 3,
  // 防小基数百分比爆炸：上期投入低于此(min)时不算百分比，改判 new / 只显示绝对值（校准 T2）。
  trendPctBaseFloorMin: 30,
  // 窗口预设（天）。
  trendPresetDays: [7, 30, 90],
} as const;
