import { TaskSchema, type Task } from "@timedata/shared";
import { db } from "../../db/index.js";

export async function listAllTasksForGoals(): Promise<Task[]> {
  const rows = await db.tasks.toArray();
  return rows.flatMap((row) => {
    const parsed = TaskSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}
