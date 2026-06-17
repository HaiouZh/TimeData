import type { Task } from "@timedata/shared";
import { getDateString } from "../time.js";
import { recurrenceSummary } from "./recurrence.js";

function formatMonthSlashDay(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

export function taskTimeLabel(task: Pick<Task, "recurrence" | "scheduledAt">): string {
  if (task.recurrence) return recurrenceSummary(task.recurrence);
  if (task.scheduledAt) return formatMonthSlashDay(getDateString(new Date(task.scheduledAt)));
  return "设定时间";
}
