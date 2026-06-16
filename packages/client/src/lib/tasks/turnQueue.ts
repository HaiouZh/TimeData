import type { Task } from "@timedata/shared";

function byTurnAtAsc(a: Task, b: Task): number {
  return (a.turnAt ?? "").localeCompare(b.turnAt ?? "");
}

export function selectWaitingOnMe(tasks: Task[]): Task[] {
  return tasks.filter((task) => !task.done && task.turn === "me").sort(byTurnAtAsc);
}

export function selectRunning(tasks: Task[]): Task[] {
  return tasks.filter((task) => !task.done && task.turn === "running").sort(byTurnAtAsc);
}
