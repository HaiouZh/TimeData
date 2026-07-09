import type { Task } from "@timedata/shared";
import { occurrenceChildId } from "./occurrenceChildId.js";

export interface ProjectedTemplateChild {
  child: Task;
  /** 「最新那一发」对应子任务的完成态；无目标发/子任务缺失时 false。 */
  effectiveDone: boolean;
  /** 勾选应写入的 occ 子任务确定性 id；无目标发时 null（UI 置灰）。 */
  targetOccChildId: string | null;
}

/**
 * 规则行子任务投影：模板子任务给结构/标题，完成态代理到「当前待做那一发」的对应子任务。
 * 纯函数无 IO；latestOccurrence 由调用方选出 active（未完成未跳过）一发，无 active（含
 * 最新一发已完成、下一发未物化的空档期）传 null → 全部显示未勾且置灰。
 */
export function projectTemplateChildren(
  templateChildren: Task[],
  latestOccurrence: Task | null,
  occurrenceChildren: Task[],
): ProjectedTemplateChild[] {
  if (!latestOccurrence) {
    return templateChildren.map((child) => ({ child, effectiveDone: false, targetOccChildId: null }));
  }
  const byId = new Map(occurrenceChildren.map((child) => [child.id, child]));
  return templateChildren.map((child) => {
    const targetOccChildId = occurrenceChildId(latestOccurrence.id, child.id);
    return {
      child,
      effectiveDone: byId.get(targetOccChildId)?.done ?? false,
      targetOccChildId,
    };
  });
}
