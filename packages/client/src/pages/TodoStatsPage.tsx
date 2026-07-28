import type { Goal, Task } from "@timedata/shared";
import { TaskSchema } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { Link } from "react-router";
import { db } from "../db/index.ts";
import { listTasks, type TodoBuckets } from "../lib/tasks.js";
import { useStatsLayoutForKey } from "../lib/statsLayoutSetting.ts";
import { getDateString } from "../lib/time.ts";
import { TODO_STATS_MODULE_LIST, TODO_STATS_MODULES } from "./stats/todo/todoStatsModules.ts";
import type { TodoStatsModuleId, TodoStatsModuleProps } from "./stats/todo/types.ts";

const TODO_STATS_LAYOUT_KEY = "stats.todo.layout.v1";

const EMPTY_BUCKETS: TodoBuckets = {
  today: [],
  inbox: [],
  scheduled: [],
  scheduledSunkenFromIndex: 0,
  recurring: [],
  completed: [],
  atHand: [],
  handSession: null,
  projects: [],
  goalLinkedIds: new Set(),
};

export default function TodoStatsPage() {
  const today = getDateString(new Date());
  const layout = useStatsLayoutForKey<TodoStatsModuleId>(TODO_STATS_LAYOUT_KEY, TODO_STATS_MODULE_LIST);

  const buckets = useLiveQuery(() => listTasks(), []) ?? EMPTY_BUCKETS;

  const tasks: Task[] =
    useLiveQuery(async () => {
      const rows = await db.tasks.toArray();
      const parsed: Task[] = [];
      for (const row of rows) {
        const result = TaskSchema.safeParse(row);
        if (result.success) parsed.push(result.data);
      }
      return parsed;
    }, []) ?? [];

  const goals: Goal[] = useLiveQuery(() => db.goals.toArray(), []) ?? [];

  const moduleContext = useMemo<TodoStatsModuleProps>(
    () => ({ today, tasks, buckets, goals }),
    [today, tasks, buckets, goals],
  );

  return (
    <div className="min-h-full space-y-4 bg-page px-3.5 pb-6 pt-4 text-ink sm:px-6">
      <header className="rounded-card border border-border bg-surface p-4 shadow-elev1">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-2">TimeData</div>
        <h2 className="mt-1 text-2xl font-semibold tracking-normal text-ink">待办统计</h2>
      </header>

      {layout.visibleModulesInOrder.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-surface p-8 text-center text-sm text-ink-3">
          所有统计模块已隐藏。
          <Link to="/settings/todo-stats-layout" className="ml-1 text-accent underline">
            去设置启用
          </Link>
        </div>
      ) : (
        layout.visibleModulesInOrder.map((id) => {
          const module = TODO_STATS_MODULES[id];
          if (!module) return null;
          const Module = module.component;
          return <Module key={id} {...moduleContext} />;
        })
      )}
    </div>
  );
}
