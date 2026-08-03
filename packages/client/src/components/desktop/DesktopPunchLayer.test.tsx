import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DesktopPunchLayer } from "./DesktopPunchLayer.js";

const UNDO = { message: "已打点 09:00–09:15" };
const CONFIRM = { message: "要把 09:00–14:30 记为打点吗？", retry: false };

type ClickableProps = { children?: ReactNode; onClick?: () => void };

function flatten(node: ReactNode, out: ReactElement<ClickableProps>[] = []): ReactElement<ClickableProps>[] {
  if (Array.isArray(node)) {
    for (const child of node) flatten(child as ReactNode, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const element = node as ReactElement<ClickableProps>;
  out.push(element);
  return flatten(element.props.children, out);
}

// 本层是无 hook 的纯展示组件，可以直接当函数调用拿到元素树。node 环境没有 DOM，
// 渲染成 markup 只看得见文案、看不见 onClick 挂没挂上，按钮接线只能从元素树上验。
function press(tree: ReactNode, label: string): void {
  const button = flatten(tree).find(
    (element) =>
      element.type === "button" &&
      typeof element.props.children === "string" &&
      element.props.children.trim() === label,
  );
  if (!button) throw new Error(`没有找到文案为「${label}」的按钮`);
  button.props.onClick?.();
}

function markup(props: Parameters<typeof DesktopPunchLayer>[0]): string {
  return renderToStaticMarkup(createElement(DesktopPunchLayer, props));
}

const NOOP = {
  onUndo: () => {},
  onDismissUndo: () => {},
  onConfirm: () => {},
  onCancelConfirm: () => {},
};

describe("DesktopPunchLayer", () => {
  it("undo 与 confirm 都为 null 时什么都不渲染", () => {
    expect(markup({ undo: null, confirm: null, ...NOOP })).toBe("");
  });

  it("撤销条渲染文案与 role=status", () => {
    const html = markup({ undo: UNDO, confirm: null, ...NOOP });
    expect(html).toContain('role="status"');
    expect(html).toContain("已打点 09:00–09:15");
  });

  it("撤销条的「撤销」接 onUndo、「✕」接 onDismissUndo", () => {
    const onUndo = vi.fn();
    const onDismissUndo = vi.fn();
    const tree = DesktopPunchLayer({ undo: UNDO, confirm: null, ...NOOP, onUndo, onDismissUndo });
    press(tree, "撤销");
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onDismissUndo).not.toHaveBeenCalled();
    press(tree, "✕");
    expect(onDismissUndo).toHaveBeenCalledOnce();
  });

  it("确认卡渲染预览区间与 role=alertdialog", () => {
    const html = markup({ undo: null, confirm: CONFIRM, ...NOOP });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("要把 09:00–14:30 记为打点吗？");
  });

  it("确认卡的「记录」「算了」各自回调", () => {
    const onConfirm = vi.fn();
    const onCancelConfirm = vi.fn();
    const tree = DesktopPunchLayer({ undo: null, confirm: CONFIRM, ...NOOP, onConfirm, onCancelConfirm });
    press(tree, "记录");
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancelConfirm).not.toHaveBeenCalled();
    press(tree, "算了");
    expect(onCancelConfirm).toHaveBeenCalledOnce();
  });

  it("首次弹卡的副文案说的是阈值", () => {
    const html = markup({ undo: null, confirm: { ...CONFIRM, retry: false }, ...NOOP });
    expect(html).toContain("间隔超过了确认阈值");
    expect(html).not.toContain("刚才那条记录已不在了");
  });

  // 点了「记录」后又弹一次时，用户看到的是一个变长了的新区间。副文案不与首次区分，
  // 用户只会以为自己点的那下没生效。
  it("重试弹卡的副文案说的是记录没了、区间比看到的更长", () => {
    const html = markup({ undo: null, confirm: { ...CONFIRM, retry: true }, ...NOOP });
    expect(html).toContain("刚才那条记录已不在了，区间比你看到的更长");
    expect(html).not.toContain("间隔超过了确认阈值");
  });
});
