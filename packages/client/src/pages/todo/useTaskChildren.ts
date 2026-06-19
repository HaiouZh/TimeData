import type { Task } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/index.js";

/**
 * 订阅某个父任务的 children（独立 Task 行，按 sortOrder 升序）。
 * parentId=null 时不查库，返回空数组。
 */
export function useTaskChildren(parentId: string | null): Task[] {
  return (
    useLiveQuery(
      () =>
        parentId
          ? db.tasks.where("parentId").equals(parentId).sortBy("sortOrder")
          : Promise.resolve([] as Task[]),
      [parentId],
      [] as Task[],
    ) ?? []
  );
}