// @vitest-environment jsdom
import { act, createElement } from "react";
import type { Goal } from "@timedata/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { GoalEditSheet, type GoalEditSheetProps } from "./GoalEditSheet.js";

const now = "2026-06-23T01:00:00.000Z";
let mountedRoot: Awaited<ReturnType<typeof renderDom>>["root"] | null = null;

afterEach(async () => {
  if (mountedRoot) await unmount(mountedRoot);
  mountedRoot = null;
});

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    title: "发布 v2",
    kind: "project",
    status: "active",
    members: [],
    prerequisites: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function props(overrides: Partial<GoalEditSheetProps> = {}): GoalEditSheetProps {
  return {
    open: true,
    goal: goal(),
    onSave: vi.fn(),
    onToggleArchive: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

async function renderSheet(overrides: Partial<GoalEditSheetProps> = {}) {
  const rendered = await renderDom(createElement(GoalEditSheet, props(overrides)));
  mountedRoot = rendered.root;
  return rendered;
}

function inputByLabel(root: ParentNode, label: string): HTMLInputElement {
  const input = root.querySelector(`input[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing input: ${label}`);
  return input;
}

function textareaByLabel(root: ParentNode, label: string): HTMLTextAreaElement {
  const textarea = root.querySelector(`textarea[aria-label="${label}"]`);
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error(`missing textarea: ${label}`);
  return textarea;
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button: ${text}`);
  return button;
}

function buttonsByText(root: ParentNode, text: string): HTMLButtonElement[] {
  return [...root.querySelectorAll("button")].filter(
    (item): item is HTMLButtonElement => item instanceof HTMLButtonElement && Boolean(item.textContent?.includes(text)),
  );
}

async function typeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function typeTextarea(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("GoalEditSheet", () => {
  it("does not render while closed", async () => {
    const { host } = await renderSheet({ open: false });

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toBe("");
  });

  it("saves a trimmed patch with nullable note and selected kind", async () => {
    const onSave = vi.fn();
    const { host } = await renderSheet({ goal: goal({ note: "原备注" }), onSave });

    await typeInput(inputByLabel(host, "目标标题"), "  发布 v2.1  ");
    await typeTextarea(textareaByLabel(host, "目标备注"), "   ");
    await click(buttonByText(host, "主题"));
    await click(buttonByText(host, "保存目标"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ title: "发布 v2.1", note: null, kind: "theme" });
  });

  it("keeps empty titles local and shows a validation message", async () => {
    const onSave = vi.fn();
    const { host } = await renderSheet({ onSave });

    await typeInput(inputByLabel(host, "目标标题"), "   ");
    await click(buttonByText(host, "保存目标"));

    expect(onSave).not.toHaveBeenCalled();
    expect(host.textContent).toContain("目标标题不能为空");
  });

  it("labels archive actions from status and delegates the toggle", async () => {
    const archive = vi.fn();
    const active = await renderSheet({ goal: goal({ status: "active" }), onToggleArchive: archive });

    await click(buttonByText(active.host, "归档目标"));
    expect(archive).toHaveBeenCalledTimes(1);

    await unmount(active.root);
    mountedRoot = null;

    const restore = vi.fn();
    const archived = await renderSheet({ goal: goal({ status: "archived" }), onToggleArchive: restore });

    await click(buttonByText(archived.host, "恢复目标"));
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("requires confirmation before deleting", async () => {
    const onDelete = vi.fn();
    const { host } = await renderSheet({ onDelete });

    await click(buttonByText(host, "删除目标"));

    expect(onDelete).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("目标会被删除");

    const deleteButtons = buttonsByText(document.body, "删除目标");
    await click(deleteButtons[deleteButtons.length - 1]);

    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
