import { latestOccurrenceForRule, type Task } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/index.js";

export interface LatestOccurrenceChildren {
  latestOccurrence: Task | null;
  occurrenceChildren: Task[];
}

/** 订阅规则名下最新非 skipped occurrence 及其 children，供规则行子任务投影使用。 */
export function useLatestOccurrenceChildren(rule: Task | null): LatestOccurrenceChildren {
  return (
    useLiveQuery(async () => {
      if (rule == null) return { latestOccurrence: null, occurrenceChildren: [] };
      const occurrences = await db.tasks.where("ruleId").equals(rule.id).toArray();
      const latestOccurrence = latestOccurrenceForRule(rule.id, occurrences);
      const occurrenceChildren =
        latestOccurrence == null ? [] : await db.tasks.where("parentId").equals(latestOccurrence.id).toArray();
      return { latestOccurrence, occurrenceChildren };
    }, [rule?.id]) ?? { latestOccurrence: null, occurrenceChildren: [] }
  );
}
