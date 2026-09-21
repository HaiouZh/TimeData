import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";
import { useKeyboardHeightSettled } from "../hooks/useKeyboardHeight.js";
import { composeFlowKeyboardInset } from "../lib/bottomInset.js";

export interface KeyboardInsetFrameProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** 底栏在文档流里时的占位（`!wide && !navHidden ? BOTTOM_NAV_HEIGHT_PX : 0`），与 `useBottomInset` 同名同义。 */
  navOffsetBasePx: number;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}

/**
 * **固定填高、内部滚动**的整页容器的键盘让位（日记页编辑器一类）：容器自己不滚，键盘盖住它下半截时
 * 滚动落点那套帮不了忙，得靠 padding-bottom 让容器内容区变矮、内滚窗缩到键盘上方，浏览器原生才保证
 * 光标行可见。
 *
 * 与 `KeyboardInsetPad`（列表尾留白）/ `KeyboardInsetSlot`（浮层与 sticky）同族、同一条叶子化纪律
 * （mobile-keyboard R8 design §3.1）：**唯一订阅键盘的是它自己**，页面把整页内容当 children 交进来，
 * 本组件重渲染时 children 引用不变、React 跳过整棵子树（闸：KeyboardInsetFrame.test）。页面根照旧
 * 不许碰键盘 hook（闸：pages/pagesNoKeyboardSubscription.test.ts）。
 *
 * 让位量走 `composeFlowKeyboardInset` 的**减法**口径而不是 `composeBottomInset` 的加法：那边服务的是
 * 从屏幕底定位的 fixed 元素，这边的容器底边被文档流底栏顶高了一截，照搬遮挡量会多让一个底栏高
 * （真机表现即「输入法上方一行黑条」，原委见该函数注释）。
 *
 * 吃 **settled** 值而非即时值：这刀 padding 改的是容器高度、是实打实的重排，与内容留白同档——键盘
 * 动画期零布局，did 事件（或超时）后一次到位。顺带消掉即时值下那段瞬态：安卓 willShow 在动画**开始**
 * 就带着最终高度到达，即时跟随会让内容底边先一步跳到最终位置，键盘还在半路，中间那段照样露底色。
 */
export function KeyboardInsetFrame({ navOffsetBasePx, ref, style, children, ...rest }: KeyboardInsetFrameProps) {
  const settledPx = useKeyboardHeightSettled();
  const frameStyle = {
    paddingBottom: composeFlowKeyboardInset({ keyboardHeightPx: settledPx, navOffsetPx: navOffsetBasePx }),
    ...style,
  } as CSSProperties;
  return (
    <div ref={ref} style={frameStyle} {...rest}>
      {children}
    </div>
  );
}
