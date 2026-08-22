import { useMemo } from "react";
import { getSetting, setSetting, useSetting } from "./index.ts";

/**
 * 用户显式按下沉睡的项目 id。
 *
 * 走 settings 同步域（LWW 整值覆盖）而不是 Goal 上的新字段：它表达的是「我先不做了」这个**看法**，
 * 与项目本身的数据无关，而加 Goal 字段要 client / server / cli / Dexie / 夹具一起对齐
 *（见 AGENTS.md「Schema / 字段变更」）——对一个分区偏好来说不成比例。
 *
 * LWW 的代价是两台设备同时改会互相覆盖、丢掉其中一次按下。对单人低频操作可接受，
 * 且已有先例（睡眠分类、导航可见入口都是这么存的）。
 *
 * 项目删除 / 归档后这里会留下孤儿 id：**不清理**，读取侧按现存项目取交集即可
 *（`TodoPage` 只拿它查 `buckets.projects` 里的组）。主动清理要么得挂删除钩子、要么得定期扫全表，
 * 换来的只是一个用户看不见的字符串。
 */
export const DORMANT_PROJECTS_KEY = "todo.dormantProjects.v1";

export function sanitizeDormantProjects(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
  }
  return [...seen];
}

function parseDormantProjects(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return sanitizeDormantProjects(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function readDormantProjects(): Promise<Set<string>> {
  return new Set(parseDormantProjects(await getSetting(DORMANT_PROJECTS_KEY)));
}

/**
 * 按下 / 唤回一个项目。**读-改-写**而不是整表覆盖：调用方只知道自己这一个 id，
 * 让它拼整份列表就等于把「别的项目睡没睡」的账也算到它头上。
 *
 * 值没变时一个字都不写：菜单项点两下同一个方向、或对着从没睡过的项目点唤回，
 * 都不该往 syncLog 里塞一条空推送。
 */
export async function setProjectDormant(goalId: string, dormant: boolean): Promise<void> {
  const current = await readDormantProjects();
  if (current.has(goalId) === dormant) return;
  if (dormant) current.add(goalId);
  else current.delete(goalId);
  await setSetting(DORMANT_PROJECTS_KEY, JSON.stringify([...current]));
}

export function useDormantProjects(): ReadonlySet<string> {
  const raw = useSetting(DORMANT_PROJECTS_KEY);
  return useMemo(() => new Set(parseDormantProjects(raw)), [raw]);
}
