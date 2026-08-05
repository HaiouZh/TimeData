import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DesktopPunchLayer } from "./DesktopPunchLayer.js";

const UNDO = { message: "已打点 09:00–09:15" };
const CONFIRM = { message: "要把 09:00–14:30 记为打点吗？", retry: false };
const NOTICE = { message: "请先在设置里选择打点分类" };

type ClickableProps = { children?: ReactNode; onClick?: () => void; "aria-label"?: string };

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
// label 同时认文字按钮的文案与图标按钮的 aria-label（关闭钮是 Phosphor 图标，没有文本子节点）。
function press(tree: ReactNode, label: string): void {
  const button = flatten(tree).find(
    (element) =>
      element.type === "button" &&
      ((typeof element.props.children === "string" && element.props.children.trim() === label) ||
        element.props["aria-label"] === label),
  );
  if (!button) throw new Error(`没有找到文案 / aria-label 为「${label}」的按钮`);
  button.props.onClick?.();
}

function markup(props: Parameters<typeof DesktopPunchLayer>[0]): string {
  return renderToStaticMarkup(createElement(DesktopPunchLayer, props));
}

const NOOP = {
  onUndo: () => {},
  onDismissUndo: () => {},
  onDismissNotice: () => {},
  onConfirm: () => {},
  onCancelConfirm: () => {},
};

describe("DesktopPunchLayer", () => {
  it("undo 与 confirm 都为 null 时什么都不渲染", () => {
    expect(markup({ undo: null, confirm: null, notice: null, ...NOOP })).toBe("");
  });

  it("撤销条渲染文案与 role=status", () => {
    const html = markup({ undo: UNDO, confirm: null, notice: null, ...NOOP });
    expect(html).toContain('role="status"');
    expect(html).toContain("已打点 09:00–09:15");
  });

  it("撤销条的「撤销」接 onUndo、「✕」接 onDismissUndo", () => {
    const onUndo = vi.fn();
    const onDismissUndo = vi.fn();
    const tree = DesktopPunchLayer({ undo: UNDO, confirm: null, notice: null, ...NOOP, onUndo, onDismissUndo });
    press(tree, "撤销");
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onDismissUndo).not.toHaveBeenCalled();
    press(tree, "关闭");
    expect(onDismissUndo).toHaveBeenCalledOnce();
  });

  // 「不写」与失败的窗口内落点：系统通知会被专注助手 / 关掉的通知权限静默吞掉，
  // 这一条画在窗口里，不经通知通道。
  it("提示条渲染文案与 role=status", () => {
    const html = markup({ undo: null, confirm: null, notice: NOTICE, ...NOOP });
    expect(html).toContain('role="status"');
    expect(html).toContain("请先在设置里选择打点分类");
  });

  it("提示条的「✕」接 onDismissNotice，不误接撤销那条的回调", () => {
    const onDismissNotice = vi.fn();
    const onDismissUndo = vi.fn();
    const tree = DesktopPunchLayer({
      undo: null,
      confirm: null,
      notice: NOTICE,
      ...NOOP,
      onDismissNotice,
      onDismissUndo,
    });
    press(tree, "关闭提示");
    expect(onDismissNotice).toHaveBeenCalledOnce();
    expect(onDismissUndo).not.toHaveBeenCalled();
  });

  it("提示条与撤销条可以同时在（后者不被前者顶掉）", () => {
    const html = markup({ undo: UNDO, confirm: null, notice: NOTICE, ...NOOP });
    expect(html).toContain("请先在设置里选择打点分类");
    expect(html).toContain("已打点 09:00–09:15");
  });

  it("确认卡渲染预览区间与 role=alertdialog", () => {
    const html = markup({ undo: null, confirm: CONFIRM, notice: null, ...NOOP });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("要把 09:00–14:30 记为打点吗？");
  });

  it("确认卡的「记录」「算了」各自回调", () => {
    const onConfirm = vi.fn();
    const onCancelConfirm = vi.fn();
    const tree = DesktopPunchLayer({ undo: null, confirm: CONFIRM, notice: null, ...NOOP, onConfirm, onCancelConfirm });
    press(tree, "记录");
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancelConfirm).not.toHaveBeenCalled();
    press(tree, "算了");
    expect(onCancelConfirm).toHaveBeenCalledOnce();
  });

  it("首次弹卡的副文案说的是阈值", () => {
    const html = markup({ undo: null, confirm: { ...CONFIRM, retry: false }, notice: null, ...NOOP });
    expect(html).toContain("间隔超过了确认阈值");
    expect(html).not.toContain("刚才那条记录已不在了");
  });

  // 点了「记录」后又弹一次时，用户看到的是一个变长了的新区间。副文案不与首次区分，
  // 用户只会以为自己点的那下没生效。
  it("重试弹卡的副文案说的是记录没了、区间比看到的更长", () => {
    const html = markup({ undo: null, confirm: { ...CONFIRM, retry: true }, notice: null, ...NOOP });
    expect(html).toContain("刚才那条记录已不在了，区间比你看到的更长");
    expect(html).not.toContain("间隔超过了确认阈值");
  });
});
