/**
 * 乐观重排的显示层应用：按目标序重排任务数组，行本身不变。
 *
 * 拖拽放手瞬间先同步渲染新序（不等落库回流），让 dnd-kit 的 transform 归位
 * 动画直接作用在新序上，避免「先弹回原位再硬跳新序」的两段视觉。
 *
 * 防御：长度不符 / id 集合不一致 / 有 id 查不到行时原样返回（宁可显示真实序，
 * 也不拿乐观序覆盖未知数据）。
 */
export function applyOptimisticOrder<T extends { id: string }>(
  tasks: readonly T[],
  orderedIds: readonly string[],
): T[] {
  if (tasks.length !== orderedIds.length) return [...tasks];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ordered = orderedIds.map((id) => byId.get(id)).filter((t): t is T => t !== undefined);
  return ordered.length === tasks.length ? ordered : [...tasks];
}
