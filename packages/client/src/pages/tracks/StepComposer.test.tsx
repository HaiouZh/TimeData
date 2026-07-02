// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { resolveStepMode, StepComposer, type StepDraft } from "./StepComposer.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | null {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === text) ?? null;
}

async function type(host: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setValue?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function typeInput(host: HTMLElement, label: string, value: string): Promise<void> {
  await act(async () => {
    const input = host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(host: HTMLElement): Promise<void> {
  await act(async () => {
    (host.querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("StepComposer", () => {
  it("submits a written step in open mode and clears content", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} />);
    const host = mounted.host;
    expect(host.textContent).toContain("写一步");
    expect(host.textContent).not.toContain("开始做这段");
    expect(host.textContent).not.toContain("记一个点");
    await type(host, "  下场推进一段  ");
    await submit(host);
    expect(onSubmit).toHaveBeenCalledWith({ content: "下场推进一段", mode: "open", tags: [] });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("renders board signals and common retrieval tags as ordinary tag chips", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} statusTags={["待我处理", "agent在做"]} />);
    const host = mounted.host;
    expect(host.textContent).toContain("看板信号");
    expect(host.textContent).toContain("#待我处理");
    expect(host.textContent).toContain("#agent在做");
    expect(host.textContent).toContain("常用标签");
    expect(host.textContent).toContain("#批注");
    expect(host.textContent).not.toContain("状态/交棒");
  });

  it("submits one selected tag and replaces it with a later selection", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} statusTags={["待我处理", "agent在做"]} />);
    const host = mounted.host;
    await click(buttonByText(host, "#待我处理"));
    await click(buttonByText(host, "#agent在做"));
    await type(host, "交给 agent 执行");
    await submit(host);
    expect(onSubmit).toHaveBeenCalledWith({ content: "交给 agent 执行", mode: "open", tags: ["agent在做"] });
  });

  it("uses a custom tag when no chip is selected and clears it after submit", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} statusTags={["待我处理"]} />);
    const host = mounted.host;
    await typeInput(host, "自定义步骤标签", "  需复盘  ");
    await type(host, "补一条临时状态");
    await submit(host);
    expect(onSubmit).toHaveBeenCalledWith({ content: "补一条临时状态", mode: "open", tags: ["需复盘"] });
    expect((host.querySelector('input[aria-label="自定义步骤标签"]') as HTMLInputElement).value).toBe("");
  });

  it("combines a single board signal with multiple retrieval tags and custom text", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} statusTags={["待我处理", "agent在做"]} />);
    const host = mounted.host;
    await click(buttonByText(host, "#agent在做"));
    await click(buttonByText(host, "#决策"));
    await click(buttonByText(host, "#提醒"));
    await typeInput(host, "自定义步骤标签", "复盘");
    await type(host, "拍板并交给 agent");
    await submit(host);
    expect(onSubmit).toHaveBeenCalledWith({
      content: "拍板并交给 agent",
      mode: "open",
      tags: ["agent在做", "决策", "提醒", "复盘"],
    });
  });

  it("does not wipe the custom tag input when a preset is selected", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} statusTags={["待我处理"]} />);
    const host = mounted.host;
    await typeInput(host, "自定义步骤标签", "自定义X");
    await click(buttonByText(host, "#待我处理"));
    expect((host.querySelector('input[aria-label="自定义步骤标签"]') as HTMLInputElement).value).toBe("自定义X");
  });

  it("marks a pure note step as instant so it does not interrupt an open segment", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} />);
    const host = mounted.host;
    await click(buttonByText(host, "#批注"));
    await type(host, "顺手记一笔");
    await submit(host);
    expect(onSubmit).toHaveBeenCalledWith({ content: "顺手记一笔", mode: "instant", tags: ["批注"] });
  });

  it("keeps a note step with a board signal as open (a real handoff)", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} statusTags={["待我处理"]} />);
    const host = mounted.host;
    await click(buttonByText(host, "#提醒"));
    await click(buttonByText(host, "#待我处理"));
    await type(host, "提醒并交回");
    await submit(host);
    expect(onSubmit).toHaveBeenCalledWith({ content: "提醒并交回", mode: "open", tags: ["待我处理", "提醒"] });
  });

  it("does not submit blank content", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} />);
    const host = mounted.host;
    await type(host, "   ");
    await submit(host);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the draft and shows an inline error when the write fails", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("写不进去"));
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} />);
    const host = mounted.host;
    await type(host, "要保住的草稿");
    await submit(host);
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("要保住的草稿");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("写不进去");
  });

  it("resolveStepMode: 信号步→open,纯点记→instant,纯正文/决策→open", () => {
    expect(resolveStepMode("待我处理", ["批注"])).toBe("open");
    expect(resolveStepMode(null, ["批注"])).toBe("instant");
    expect(resolveStepMode(null, ["提醒"])).toBe("instant");
    expect(resolveStepMode(null, [])).toBe("open");
    expect(resolveStepMode(null, ["决策"])).toBe("open");
    expect(resolveStepMode(null, ["批注", "决策"])).toBe("instant");
  });

  it("uses inline surface and custom submit label for card writing", async () => {
    const submitted: StepDraft[] = [];
    mounted = await renderDom(
      <StepComposer
        statusTags={["待我处理"]}
        surface="inline"
        submitLabel="写入这一步"
        onSubmit={(draft) => submitted.push(draft)}
      />,
    );
    const host = mounted.host;
    expect(host.textContent).toContain("写入这一步");
    await type(host, "就地推进一下");
    await click(buttonByText(host, "#待我处理"));
    await submit(host);
    expect(submitted).toEqual([{ content: "就地推进一下", mode: "open", tags: ["待我处理"] }]);
  });
});
