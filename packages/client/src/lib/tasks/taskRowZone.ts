export type RowClickZone = "expand" | "open";

// 所有行统一：左 2/5 = 进入子任务层（展开/开草稿），右 3/5 = 打开详情抽屉。
// readonly（已完成 occurrence 快照）等宿主级例外由 TaskRow 自行短路，不进本函数。
export function rowClickZone(offsetX: number, width: number): RowClickZone {
  return offsetX < (width * 2) / 5 ? "expand" : "open";
}
