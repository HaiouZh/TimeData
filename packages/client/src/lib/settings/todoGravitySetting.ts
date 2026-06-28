import { useMemo } from "react";
import { getSetting, setSetting, useSetting } from "./index.ts";
import {
  DEFAULT_TODO_GRAVITY_SETTINGS,
  type TodoGravitySettings,
} from "../tasks/gravity.ts";

export const TODO_GRAVITY_SETTING_KEY = "todo.gravity.v1";
export { DEFAULT_TODO_GRAVITY_SETTINGS };

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, number));
}

export function sanitizeTodoGravitySettings(value: unknown): TodoGravitySettings {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const drawM = clampInt(record.drawM, DEFAULT_TODO_GRAVITY_SETTINGS.drawM, 1, 10);
  const pickN = clampInt(record.pickN, DEFAULT_TODO_GRAVITY_SETTINGS.pickN, 1, drawM);
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_TODO_GRAVITY_SETTINGS.enabled,
    waterlineDays: clampInt(record.waterlineDays, DEFAULT_TODO_GRAVITY_SETTINGS.waterlineDays, 1, 365),
    weightStepDays: clampInt(record.weightStepDays, DEFAULT_TODO_GRAVITY_SETTINGS.weightStepDays, 1, 365),
    graceDays: clampInt(record.graceDays, DEFAULT_TODO_GRAVITY_SETTINGS.graceDays, 0, 365),
    drawM,
    pickN,
  };
}

function parseTodoGravitySettings(raw: string | null): TodoGravitySettings {
  if (!raw) return DEFAULT_TODO_GRAVITY_SETTINGS;
  try {
    return sanitizeTodoGravitySettings(JSON.parse(raw));
  } catch {
    return DEFAULT_TODO_GRAVITY_SETTINGS;
  }
}

export async function readTodoGravitySettings(): Promise<TodoGravitySettings> {
  return parseTodoGravitySettings(await getSetting(TODO_GRAVITY_SETTING_KEY));
}

export function setTodoGravitySettings(settings: TodoGravitySettings): Promise<void> {
  return setSetting(TODO_GRAVITY_SETTING_KEY, JSON.stringify(sanitizeTodoGravitySettings(settings)));
}

export function useTodoGravitySettings(): TodoGravitySettings {
  const raw = useSetting(TODO_GRAVITY_SETTING_KEY);
  return useMemo(() => parseTodoGravitySettings(raw), [raw]);
}