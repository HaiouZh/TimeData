import { nextDueDate, type Task } from "@timedata/shared";
import { formatYearAwareMonthDay, getDateString } from "../time.js";
import { currentDueDateString, recurrenceSummary } from "./recurrence.js";

type TaskTimeLabelInput = Pick<Task, "recurrence" | "scheduledAt"> &
  Partial<Pick<Task, "lastDoneAt" | "startAt">>;

export function taskTimeLabel(task: TaskTimeLabelInput, processedOccurrences: Task[] = []): string {
  if (task.recurrence) {
    const dueDate =
      processedOccurrences.length > 0
        ? nextDueDate(task as Task, processedOccurrences)
        : currentDueDateString(task.recurrence, task.lastDoneAt ?? null, task.startAt ?? null);
    if (dueDate == null) return recurrenceSummary(task.recurrence);
    return `${recurrenceSummary(task.recurrence)} · ${formatYearAwareMonthDay(dueDate)}`;
  }
  if (task.scheduledAt) return formatYearAwareMonthDay(getDateString(new Date(task.scheduledAt)));
  return "设定时间";
}

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
