// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { act, createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/index.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import GoalsListPage from "./GoalsListPage.js";

vi.mock("../../contexts/SyncContext.js", () => ({ useSyncContext: () => ({ syncAfterWrite: vi.fn() }) }));

let mountedRoot: Awaited<ReturnType<typeof renderDom>>["root"] | null = null;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  if (mountedRoot) await unmount(mountedRoot);
  mountedRoot = null;
  await db.delete();
});

async function waitForText(host: HTMLElement, text: string): Promise<void> {
  for (let index = 0; index < 20; index++) {
    if (host.textContent?.includes(text)) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  expect(host.textContent).toContain(text);
}

function inputByLabel(host: HTMLElement, label: string): HTMLInputElement {
  const input = host.querySelector(`input[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing input: ${label}`);
  return input;
}

async function typeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("GoalsListPage", () => {
  it("creates a project goal and renders project progress", async () => {
    const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(GoalsListPage)));
    mountedRoot = root;

    await typeInput(inputByLabel(host, "新建目标标题"), "发布 v2");
    await click(host.querySelector('button[aria-label="新建目标"]'));

    await waitForText(host, "发布 v2");
    await waitForText(host, "0/0");
    await expect(db.goals.count()).resolves.toBe(1);
  });

  it("renders theme activity without project completion ratio", async () => {
    await db.goals.add({
      id: "goal-theme",
      title: "身体更健康",
      kind: "theme",
      status: "active",
      prerequisites: [],
      createdAt: "2026-06-22T01:00:00.000Z",
      updatedAt: "2026-06-22T01:00:00.000Z",
    });

    const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(GoalsListPage)));
    mountedRoot = root;

    await waitForText(host, "身体更健康");
    await waitForText(host, "近7天");
    expect(host.textContent).not.toContain("0/0");
  });
});
