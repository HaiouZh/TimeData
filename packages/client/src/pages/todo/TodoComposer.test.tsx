// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { SyncProvider } from "../../contexts/SyncContext.tsx";
import { db } from "../../db/index.js";
import { normalizeScheduledDate } from "../../lib/tasks/placement.js";
import { TodoComposer } from "./TodoComposer.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  localStorage.clear();
  await db.tasks.clear();
  await db.syncLog.clear();
});

function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderComposer() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(SyncProvider, null, createElement(TodoComposer, null))));
  return { host, root };
}

const click = (el: Element | null) =>
  act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

async function waitForInputValue(host: HTMLElement, expected: string) {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    const value = (host.querySelector('input[placeholder="添加任务…"]') as HTMLInputElement).value;
    if (value === expected) return;
    await flush();
  }
  throw new Error(`Timed out waiting for input value ${expected}`);
}

describe("TodoComposer", () => {
  it("选『每天』后添加 → 任务带 daily recurrence，提交后清空 title", async () => {
    const { host, root } = await renderComposer();
    await act(async () => setValue(host.querySelector('input[placeholder="添加任务…"]') as HTMLInputElement, "喝水"));

    await click(host.querySelector('button[aria-label="重复"]'));
    await click(host.querySelector('button[aria-label="每天"]'));
    await click(host.querySelector('button[type="submit"]'));
    await flush();

    const tasks = await db.tasks.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].recurrence).toMatchObject({ freq: "daily" });
    await waitForInputValue(host, "");
    await act(async () => root.unmount());
  });

  it("选『仅某天』后添加 → 普通排期任务", async () => {
    const { host, root } = await renderComposer();
    await act(async () => setValue(host.querySelector('input[placeholder="添加任务…"]') as HTMLInputElement, "买菜"));

    await click(host.querySelector('button[aria-label="重复"]'));
    await click(host.querySelector('button[aria-label="仅某天…"]'));
    await click(host.querySelector('button[aria-label="2026-06-20"]'));
    await click(host.querySelector('button[type="submit"]'));
    await flush();

    const tasks = await db.tasks.toArray();
    expect(tasks[0].recurrence).toBeNull();
    expect(tasks[0].scheduledAt).toBe(normalizeScheduledDate("2026-06-20"));
    await act(async () => root.unmount());
  });
});
