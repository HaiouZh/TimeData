import type { Task } from "@timedata/shared";
import { formatYearAwareMonthDay, getDateString } from "../time.js";
import { recurrenceSummary } from "./recurrence.js";

export function taskTimeLabel(task: Pick<Task, "recurrence" | "scheduledAt">): string {
  if (task.recurrence) return recurrenceSummary(task.recurrence);
  if (task.scheduledAt) return formatYearAwareMonthDay(getDateString(new Date(task.scheduledAt)));
  return "设定时间";
}