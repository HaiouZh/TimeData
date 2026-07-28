import type { Goal, Task } from "@timedata/shared";
import type { ComponentType } from "react";
import type { TodoBuckets } from "../../../lib/tasks.js";

export type TodoStatsModuleId =
  | "overview"
  | "created"
  | "completed"
  | "age"
  | "heatmap"
  | "cycle"
  | "rhythm"
  | "dimension"
  | "deleted";

export interface TodoStatsModuleProps {
  today: string; // getDateString(new Date())
  tasks: Task[]; // db.tasks 全量（TaskSchema.parse 通过的行）
  buckets: TodoBuckets; // listTasks() 结果，总览用
  goals: Goal[]; // 项目维度用（裸行 zod 宽松解析，抄 listTasks 的做法）
}

export interface TodoStatsModuleDescriptor {
  id: TodoStatsModuleId;
  defaultVisible: boolean;
}

export interface TodoStatsModuleDef extends TodoStatsModuleDescriptor {
  title: string;
  eyebrow: string;
  description: string;
  component: ComponentType<TodoStatsModuleProps>;
}
