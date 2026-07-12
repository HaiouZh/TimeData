import { nextDueDate, type Task } from "@timedata/shared";
import { formatYearAwareMonthDay, getDateString } from "../time.js";
import { currentDueDateString, recurrenceSummary } from "./recurrence.js";

type TaskTimeLabelInput = Pick<Task, "recurrence" | "scheduledAt"> &
  Partial<Pick<Task, "lastDoneAt" | "startAt">>;

/** 只返回日期部分（重复=下一应发生日/耗尽 null；非重复=排期日或"设定时间"），供 TaskRow 日期胶囊用。 */
export function taskDueDateLabel(task: TaskTimeLabelInput, processedOccurrences: Task[] = []): string | null {
  if (task.recurrence) {
    const dueDate =
      processedOccurrences.length > 0
        ? nextDueDate(task as Task, processedOccurrences)
        : currentDueDateString(task.recurrence, task.lastDoneAt ?? null, task.startAt ?? null);
    return dueDate == null ? null : formatYearAwareMonthDay(dueDate);
  }
  if (task.scheduledAt) return formatYearAwareMonthDay(getDateString(new Date(task.scheduledAt)));
  return "设定时间";
}

/** 完整时间标签：重复任务带重复摘要前缀；到期日推导唯一内核在 taskDueDateLabel。 */
export function taskTimeLabel(task: TaskTimeLabelInput, processedOccurrences: Task[] = []): string {
  const date = taskDueDateLabel(task, processedOccurrences);
  if (task.recurrence) {
    const summary = recurrenceSummary(task.recurrence);
    return date == null ? summary : `${summary} · ${date}`;
  }
  // 非重复分支 taskDueDateLabel 恒有值（排期日或"设定时间"兜底）。
  return date ?? "设定时间";
}
