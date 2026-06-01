// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import QuickNotesPage from "./QuickNotesPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => {
    for (let index = 0; index < 5; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function renderPage(initialEntry = "/quick-notes"): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [initialEntry] }, createElement(QuickNotesPage)));
  });
  await flush();
  return { host, root };
}

function input(host: HTMLElement): HTMLTextAreaElement {
  const element = host.querySelector('textarea[aria-label="速记输入"]');
  if (!(element instanceof HTMLTextAreaElement)) throw new Error("missing input");
  return element;
}

async function typeInto(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

async function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) throw new Error("missing clickable element");
  await act(async () => {
    element.click();
  });
  await flush();
}

function lastButtonByText(host: HTMLElement, text: string): HTMLButtonElement | null {
  const matches = Array.from(host.querySelectorAll("button")).filter((button) => button.textContent === text);
  return matches.at(-1) ?? null;
}

beforeEach(async () => {
  await db.quickNotes.clear();
  await db.timeEntries.clear();
  document.body.innerHTML = "";
});

describe("QuickNotesPage", () => {
  it("sends a quick note, clears the input, and leaves time entries untouched", async () => {
    const { host, root } = await renderPage();

    await typeInto(input(host), "  一个想法  ");
    await click(host.querySelector('button[type="submit"]'));

    expect(host.textContent).toContain("一个想法");
    expect(input(host).value).toBe("");
    await expect(db.quickNotes.count()).resolves.toBe(1);
    await expect(db.timeEntries.count()).resolves.toBe(0);

    await act(async () => root.unmount());
  });

  it("does not send empty text", async () => {
    const { host, root } = await renderPage();

    await typeInto(input(host), "   ");
    await click(host.querySelector('button[type="submit"]'));

    await expect(db.quickNotes.count()).resolves.toBe(0);

    await act(async () => root.unmount());
  });

  it("edits a note without changing occurredAt", async () => {
    await db.quickNotes.add({
      id: "note-1",
      text: "旧文本",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage("/quick-notes?date=2026-06-01");

    await click(host.querySelector('button[aria-label="编辑速记：旧文本"]'));
    const editInput = host.querySelector('textarea[aria-label="编辑速记内容"]');
    if (!(editInput instanceof HTMLTextAreaElement)) throw new Error("missing edit input");
    await typeInto(editInput, "新文本");
    await click(lastButtonByText(host, "保存"));

    expect(host.textContent).toContain("新文本");
    await expect(db.quickNotes.get("note-1")).resolves.toMatchObject({
      text: "新文本",
      occurredAt: "2026-06-01T04:00:00.000Z",
    });

    await act(async () => root.unmount());
  });

  it("deletes a note through the project confirm dialog", async () => {
    await db.quickNotes.add({
      id: "note-1",
      text: "待删除",
      occurredAt: "2026-06-01T04:00:00.000Z",
      createdAt: "2026-06-01T04:00:00.000Z",
      updatedAt: "2026-06-01T04:00:00.000Z",
    });
    const { host, root } = await renderPage("/quick-notes?date=2026-06-01");

    await click(host.querySelector('button[aria-label="编辑速记：待删除"]'));
    await click(lastButtonByText(host, "删除"));

    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("删除这条速记");
    await click(lastButtonByText(host, "删除"));

    expect(host.textContent).not.toContain("待删除");
    await expect(db.quickNotes.count()).resolves.toBe(0);

    await act(async () => root.unmount());
  });

  it("clears the selected date through the cleanup action", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "today",
        text: "当天",
        occurredAt: "2026-06-01T04:00:00.000Z",
        createdAt: "2026-06-01T04:00:00.000Z",
        updatedAt: "2026-06-01T04:00:00.000Z",
      },
      {
        id: "other",
        text: "别天",
        occurredAt: "2026-06-02T04:00:00.000Z",
        createdAt: "2026-06-02T04:00:00.000Z",
        updatedAt: "2026-06-02T04:00:00.000Z",
      },
    ]);
    const { host, root } = await renderPage("/quick-notes?date=2026-06-01");

    await click(lastButtonByText(host, "清理"));

    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("删除当天速记");
    await click(lastButtonByText(host, "删除"));

    await expect(db.quickNotes.get("today")).resolves.toBeUndefined();
    await expect(db.quickNotes.get("other")).resolves.toMatchObject({ text: "别天" });

    await act(async () => root.unmount());
  });

  it("shows only notes for the selected date and can move to the previous day", async () => {
    await db.quickNotes.bulkAdd([
      {
        id: "first",
        text: "六月一日",
        occurredAt: "2026-05-31T16:30:00.000Z",
        createdAt: "2026-05-31T16:30:00.000Z",
        updatedAt: "2026-05-31T16:30:00.000Z",
      },
      {
        id: "second",
        text: "六月二日",
        occurredAt: "2026-06-01T16:30:00.000Z",
        createdAt: "2026-06-01T16:30:00.000Z",
        updatedAt: "2026-06-01T16:30:00.000Z",
      },
    ]);
    const { host, root } = await renderPage("/quick-notes?date=2026-06-02");

    expect(host.textContent).toContain("六月二日");
    expect(host.textContent).not.toContain("六月一日");

    await click(host.querySelector("button"));

    expect(host.textContent).toContain("六月一日");
    expect(host.textContent).not.toContain("六月二日");

    await act(async () => root.unmount());
  });
});
