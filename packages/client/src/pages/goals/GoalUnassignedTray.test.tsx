// @vitest-environment jsdom
import type { Task, Track, TrackStep } from "@timedata/shared";
import { act } from "react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { GoalUnassignedTray } from "./GoalUnassignedTray.js";

const now = "2026-06-26T08:00:00.000Z";
let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

function task(input: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    id: input.id,
    parentId: null,
    title: input.title,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function track(input: Partial<Track> & Pick<Track, "id" | "title">): Track {
  return {
    id: input.id,
    title: input.title,
    status: "active",
    refs: [],
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function step(input: Partial<TrackStep> & Pick<TrackStep, "id" | "trackId" | "seq" | "content">): TrackStep {
  return {
    id: input.id,
    trackId: input.trackId,
    seq: input.seq,
    content: input.content,
    source: "user",
    sourceLabel: null,
    refs: [],
    tags: [],
    startedAt: now,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

async function renderTray(props: Partial<ComponentProps<typeof GoalUnassignedTray>> = {}) {
  mounted = await renderDom(
    <GoalUnassignedTray
      goals={[]}
      tasks={[]}
      tracks={[]}
      steps={[]}
      boardSignals={["待我处理", "agent在做"]}
      {...props}
    />,
  );
  return mounted;
}

function inputByLabel(root: ParentNode, label: string): HTMLInputElement {
  const input = root.querySelector(`input[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing input: ${label}`);
  return input;
}

function buttonByLabel(root: ParentNode, label: string): HTMLButtonElement {
  const button = root.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button label: ${label}`);
  return button;
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button: ${text}`);
  return button;
}

async function typeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("GoalUnassignedTray", () => {
  it("shows only globally unassigned active tasks and tracks with the shared filters", async () => {
    const rendered = await renderTray({
      tasks: [
        task({ id: "candidate", title: "写星图", tags: ["goal"] }),
        task({ id: "report", title: "写周报", tags: ["report"] }),
      ],
      tracks: [track({ id: "active-track", title: "星图轨道" })],
      steps: [step({ id: "step-1", trackId: "active-track", seq: 1, content: "等确认", tags: ["待我处理"] })],
    });

    await typeInput(inputByLabel(rendered.host, "搜索未归类项"), "星图");
    await click(buttonByLabel(rendered.host, "筛选 goal"));

    expect(rendered.host.textContent).toContain("写星图");
    expect(rendered.host.textContent).not.toContain("写周报");
    expect(rendered.host.querySelector('[data-tray-ref="task:candidate"]')).toBeTruthy();

    await click(buttonByText(rendered.host, "轨道"));
    expect(rendered.host.textContent).toContain("星图轨道");
    expect(rendered.host.textContent).toContain("等确认");
  });

  it("writes GoalMemberRef JSON to dataTransfer when a tray row is dragged", async () => {
    const rendered = await renderTray({ tasks: [task({ id: "candidate", title: "写星图" })] });
    const row = buttonByLabel(rendered.host, "拖动任务 写星图");
    const data = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "none",
      setData: (type: string, value: string) => data.set(type, value),
    };

    await act(async () => {
      const event = new Event("dragstart", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      row.dispatchEvent(event);
    });

    expect(row.draggable).toBe(true);
    expect(row.getAttribute("data-tray-ref")).toBe("task:candidate");
    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(data.get("application/x-goal-member")).toBe(JSON.stringify({ kind: "task", id: "candidate" }));
  });
});
