import { latestOccurrenceForRule, type Task } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/index.js";

export interface LatestOccurrenceChildren {
  latestOccurrence: Task | null;
  occurrenceChildren: Task[];
}

/**
 * 订阅规则名下「当前待做的一发」（active，未完成未跳过）及其 children，供规则行子任务投影使用。
 * 最新一发已完成、下一发尚未物化的空档期返回 null——规则行代表下一发，子任务显示全新未勾（置灰）。
 */
export function useLatestOccurrenceChildren(rule: Task | null): LatestOccurrenceChildren {
  return (
    useLiveQuery(async () => {
      if (rule == null) return { latestOccurrence: null, occurrenceChildren: [] };
      const occurrences = await db.tasks.where("ruleId").equals(rule.id).toArray();
      const latest = latestOccurrenceForRule(rule.id, occurrences);
      const latestOccurrence = latest != null && !latest.done ? latest : null;
      const occurrenceChildren =
        latestOccurrence == null ? [] : await db.tasks.where("parentId").equals(latestOccurrence.id).toArray();
      return { latestOccurrence, occurrenceChildren };
    }, [rule?.id]) ?? { latestOccurrence: null, occurrenceChildren: [] }
  );
}
