// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider } from "../contexts/BottomNavContext.js";
import { SyncProvider } from "../contexts/SyncContext.tsx";
import { addTask } from "../lib/tasks.js";
import { resetDb } from "../test/dbReset.js";
import { click, renderDom, unmount } from "../test/domHarness.js";
import { TodoPage } from "./TodoPage.js";

beforeEach(async () => {
  localStorage.clear();
  vi.unstubAllGlobals();
  await resetDb();
});

function LocationProbe() {
  const location = useLocation();
  return createElement("output", { "data-testid": "location-search" }, location.search);
}

function NavigateButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return createElement(
    "button",
    {
      type: "button",
      onClick: () => navigate(to),
    },
    `navigate:${to}`,
  );
}

async function renderPage(initialEntry: string, extra?: ReactNode) {
  return renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: [initialEntry] },
      createElement(
        BottomNavProvider,
        null,
        createElement(SyncProvider, null, createElement(TodoPage), createElement(LocationProbe), extra),
      ),
    ),
  );
}

async function waitForCondition(check: () => boolean, message: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (check()) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }
  throw new Error(message);
}

function detailDialog(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[role="dialog"][aria-label="任务详情"]');
}

describe("TodoPage deep link", () => {
  it("挂载 /todo?taskId=<id> 时打开任务详情", async () => {
    const task = await addTask({ title: "来自链接的任务" });

    const { host, root } = await renderPage(`/todo?taskId=${task.id}`);
    await waitForCondition(() => detailDialog(host) !== null, "Timed out waiting for task detail sheet");

    expect(detailDialog(host)).not.toBeNull();
    expect((host.querySelector('textarea[aria-label="任务标题"]') as HTMLTextAreaElement | null)?.value).toBe(
      "来自链接的任务",
    );
    await unmount(root);
  });

  it("关闭详情时移除 taskId 参数", async () => {
    const task = await addTask({ title: "关闭后清 URL" });

    const { host, root } = await renderPage(`/todo?taskId=${task.id}&view=all`);
    await waitForCondition(() => detailDialog(host) !== null, "Timed out waiting for task detail sheet");

    await click(host.querySelector('button[aria-label="关闭"]'));
    await waitForCondition(() => detailDialog(host) === null, "Timed out waiting for task detail sheet to close");

    expect(host.querySelector('[data-testid="location-search"]')?.textContent).toBe("?view=all");
    await unmount(root);
  });

  it("参数变化时切换打开任务，不存在的 taskId 自动关闭", async () => {
    const first = await addTask({ title: "第一条" });
    const second = await addTask({ title: "第二条" });

    const { host, root } = await renderPage(
      `/todo?taskId=${first.id}`,
      createElement(
        "div",
        null,
        createElement(NavigateButton, { to: `/todo?taskId=${second.id}` }),
        createElement(NavigateButton, { to: "/todo?taskId=missing-task" }),
      ),
    );
    await waitForCondition(
      () => (host.querySelector('textarea[aria-label="任务标题"]') as HTMLTextAreaElement | null)?.value === "第一条",
      "Timed out waiting for first task detail",
    );

    await click(
      Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === `navigate:/todo?taskId=${second.id}`,
      ),
    );
    await waitForCondition(
      () => (host.querySelector('textarea[aria-label="任务标题"]') as HTMLTextAreaElement | null)?.value === "第二条",
      "Timed out waiting for second task detail",
    );

    await click(
      Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === "navigate:/todo?taskId=missing-task",
      ),
    );
    await waitForCondition(() => detailDialog(host) === null, "Timed out waiting for missing task detail to close");

    await unmount(root);
  });
});
