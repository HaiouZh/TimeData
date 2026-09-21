import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";
import { type BottomInsetInput, useBottomInset } from "../hooks/useBottomInset.js";

export interface KeyboardInsetPadProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  inset: BottomInsetInput;
  /** 留白之外再加的固定间隙（Todo 的 TODO_COMPOSER_CONTENT_GAP_PX）。 */
  extraPx?: number;
  /** 留白下限（Todo 的 192）。 */
  minPx?: number;
  /** 同步写 scroll-padding-bottom（速记的滚动容器）。 */
  scrollPadding?: boolean;
  as?: "div" | "section";
  ref?: Ref<HTMLElement>;
  children: ReactNode;
}

/**
 * 内容留白容器（mobile-keyboard R8 design §3.1）：唯一订阅键盘的是它自己，页面把列表当 children
 * 传进来——本组件重渲染时 children 引用不变，React 跳过整棵列表（闸：KeyboardInsetPad.test）。native 上键盘
 * 事件因此不碰页面根；web 上壳收底栏会改 BottomNavContext、页面根随之各渲染一次（收放各一次，不是逐帧）。
 * 留白只吃 settled 值：键盘动画期零布局。`--pad-bottom` 兜底变量与 calc 组成式照旧（invariants 11）。
 */
export function KeyboardInsetPad({
  inset,
  extraPx = 0,
  minPx = 0,
  scrollPadding = false,
  as = "div",
  ref,
  style,
  children,
  ...rest
}: KeyboardInsetPadProps) {
  const { settledPx } = useBottomInset(inset);
  const px = Math.max(minPx, settledPx + extraPx);
  const padStyle = {
    "--pad-bottom": `${px}px`,
    paddingBottom: `calc(${px}px + var(--safe-bottom))`,
    ...(scrollPadding ? { scrollPaddingBottom: `calc(${px}px + var(--safe-bottom))` } : {}),
    ...style,
  } as CSSProperties;
  if (as === "section") {
    return (
      <section ref={ref} style={padStyle} {...rest}>
        {children}
      </section>
    );
  }
  return (
    <div ref={ref as Ref<HTMLDivElement>} style={padStyle} {...rest}>
      {children}
    </div>
  );
}
