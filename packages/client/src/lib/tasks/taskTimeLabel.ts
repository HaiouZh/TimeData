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
