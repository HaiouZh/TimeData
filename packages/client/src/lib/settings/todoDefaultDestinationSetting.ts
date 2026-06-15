import { getSetting, setSetting, useSetting } from "./index.js";

export const TODO_DEFAULT_DESTINATION_KEY = "todo.defaultDestination.v1";

export type TodoDestination = "today" | "inbox";

export function sanitizeDestination(value: unknown): TodoDestination {
  return value === "inbox" ? "inbox" : "today";
}

export async function readTodoDefaultDestination(): Promise<TodoDestination> {
  return sanitizeDestination(await getSetting(TODO_DEFAULT_DESTINATION_KEY));
}

export function setTodoDefaultDestination(dest: TodoDestination): Promise<void> {
  return setSetting(TODO_DEFAULT_DESTINATION_KEY, sanitizeDestination(dest));
}

export function useTodoDefaultDestination(): TodoDestination {
  const raw = useSetting(TODO_DEFAULT_DESTINATION_KEY);
  return sanitizeDestination(raw);
}
