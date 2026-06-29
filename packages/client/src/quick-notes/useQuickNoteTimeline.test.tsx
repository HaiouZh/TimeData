// @vitest-environment jsdom
import { act, createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { addQuickNote } from "../lib/quickNotes.js";
import { resetDb } from "../test/dbReset.js";
import { renderDom, unmount } from "../test/domHarness.js";
import { useQuickNoteTimeline } from "./useQuickNoteTimeline.js";

async function flush() {
  await act(async () => {
    for (let index = 0; index < 8; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

function Harness() {
  const timeline = useQuickNoteTimeline(2);
  return createElement(
    "div",
    null,
    createElement("span", { "data-testid": "count" }, String(timeline.notes.length)),
    createElement("span", { "data-testid": "hasOlder" }, String(timeline.hasOlder)),
    createElement("span", { "data-testid": "atLatest" }, String(timeline.atLatest)),
    createElement("span", { "data-testid": "texts" }, timeline.notes.map((note) => note.text).join(",")),
    createElement("button", { "data-testid": "older", onClick: () => void timeline.loadOlder() }, "older"),
    createElement("button", { "data-testid": "newer", onClick: () => void timeline.loadNewer() }, "newer"),
    createElement("button", { "data-testid": "jump", onClick: () => void timeline.jumpToDate("2026-06-02") }, "jump"),
  );
}

async function renderHarness() {
  const { host, root } = await renderDom(createElement(Harness));
  await flush();
  return { host, root };
}

function text(host: HTMLElement, id: string): string {
  return host.querySelector(`[data-testid="${id}"]`)?.textContent ?? "";
}

async function clickTestId(host: HTMLElement, id: string) {
  await act(async () => {
    (host.querySelector(`[data-testid="${id}"]`) as HTMLElement).click();
  });
  await flush();
}

async function waitForText(host: HTMLElement, id: string, expected: string) {
  for (let index = 0; index < 10; index++) {
    if (text(host, id) === expected) return;
    await flush();
  }
  expect(text(host, id)).toBe(expected);
}

beforeEach(async () => {
  await resetDb();
  document.body.innerHTML = "";

  for (let day = 1; day <= 5; day++) {
    const iso = `2026-06-0${day}T00:00:00.000Z`;
    await addQuickNote(`note-${day}`, { occurredAt: iso, now: new Date("2026-06-10T00:00:00.000Z") });
  }
});

describe("useQuickNoteTimeline", () => {
  it("starts at the latest page and grows upward via loadOlder", async () => {
    const { host, root } = await renderHarness();

    expect(text(host, "count")).toBe("2");
    expect(text(host, "texts")).toBe("note-4,note-5");
    expect(text(host, "hasOlder")).toBe("true");
    expect(text(host, "atLatest")).toBe("true");

    await clickTestId(host, "older");
    expect(text(host, "count")).toBe("4");
    expect(text(host, "texts")).toBe("note-2,note-3,note-4,note-5");
    expect(text(host, "hasOlder")).toBe("true");

    await clickTestId(host, "older");
    expect(text(host, "count")).toBe("5");
    expect(text(host, "texts")).toBe("note-1,note-2,note-3,note-4,note-5");
    expect(text(host, "hasOlder")).toBe("false");

    await unmount(root);
  });

  it("jumpToDate loads a bounded window starting at that date", async () => {
    const { host, root } = await renderHarness();

    await clickTestId(host, "jump");

    expect(text(host, "atLatest")).toBe("false");
    await waitForText(host, "texts", "note-2,note-3");

    await clickTestId(host, "newer");
    await waitForText(host, "texts", "note-2,note-3,note-4,note-5");

    await unmount(root);
  });
});
