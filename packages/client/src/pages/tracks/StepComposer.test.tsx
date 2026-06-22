// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { StepComposer, type StepDraft } from "./StepComposer.js";

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
  it("默认开口执行模式提交并清空内容", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} />);
    const host = mounted.host;
    await type(host, "  下场推进一段  ");
    await submit(host);
    expect(onSubmit).toHaveBeenCalledWith({ content: "下场推进一段", mode: "open", tags: [] });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("切到即时点并选预设 tag 后提交", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} />);
    const host = mounted.host;
    await click(buttonByText(host, "记一个点"));
    await click(buttonByText(host, "#批注"));
    await type(host, "这里要回看证据");
    await submit(host);
    expect(onSubmit).toHaveBeenCalledWith({ content: "这里要回看证据", mode: "instant", tags: ["批注"] });
  });

  it("renders status tags from props alongside instant tags", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} statusTags={["等我", "agent在做"]} />);
    const host = mounted.host;
    expect(host.textContent).toContain("状态/交棒");
    expect(host.textContent).toContain("#等我");
    expect(host.textContent).toContain("#agent在做");
    expect(host.textContent).toContain("记一笔");
    expect(host.textContent).toContain("#批注");
  });

  it("submits one selected status tag and replaces it with a later selection", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} statusTags={["等我", "agent在做"]} />);
    const host = mounted.host;
    await click(buttonByText(host, "#等我"));
    await click(buttonByText(host, "#agent在做"));
    await type(host, "交给 agent 执行");
    await submit(host);
    expect(onSubmit).toHaveBeenCalledWith({ content: "交给 agent 执行", mode: "open", tags: ["agent在做"] });
  });

  it("uses a custom tag when no chip is selected and clears it after submit", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} statusTags={["等我"]} />);
    const host = mounted.host;
    await typeInput(host, "自定义步骤标签", "  需复盘  ");
    await type(host, "补一条临时状态");
    await submit(host);
    expect(onSubmit).toHaveBeenCalledWith({ content: "补一条临时状态", mode: "open", tags: ["需复盘"] });
    expect((host.querySelector('input[aria-label="自定义步骤标签"]') as HTMLInputElement).value).toBe("");
  });

  it("空内容不提交", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} />);
    const host = mounted.host;
    await type(host, "   ");
    await submit(host);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("uses inline surface and custom submit label for card writing", async () => {
    const submitted: StepDraft[] = [];
    mounted = await renderDom(
      <StepComposer
        statusTags={["等我"]}
        surface="inline"
        submitLabel="写入这一步"
        onSubmit={(draft) => submitted.push(draft)}
      />,
    );
    const host = mounted.host;
    expect(host.textContent).toContain("写入这一步");
    await type(host, "就地推进一下");
    await click(buttonByText(host, "#等我"));
    await submit(host);
    expect(submitted).toEqual([{ content: "就地推进一下", mode: "open", tags: ["等我"] }]);
  });
});
