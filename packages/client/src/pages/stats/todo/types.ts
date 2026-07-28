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
  goals: Goal[]; // 项目维度用（db.goals.toArray() 裸行直喂，无 zod 解析；消费端 dimension.ts 对缺字段/不匹配行做兜底跳过）
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
