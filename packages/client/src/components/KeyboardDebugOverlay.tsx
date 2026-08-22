import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { useEffect, useState } from "react";
import { readViewportBottomGap, useKeyboardHeight, useKeyboardVisible } from "../hooks/useKeyboardHeight.ts";
import { Z } from "../lib/zLayers.ts";

// 单条转移记录：事件名 + 当帧的三个原始量。ms 取自挂载起点，真机截图可直接对时序。
interface DebugLogEntry {
  t: number;
  tag: string;
  ih: number;
  vvh: number;
  gap: number;
}

const LOG_LIMIT = 7;

function isEnabled(): boolean {
  if (Capacitor.getPlatform() !== "web") return true;
  try {
    return localStorage.getItem("td.kbdDebug") === "1";
  } catch {
    return false;
  }
}

function readCache(): string {
  try {
    return `${localStorage.getItem("td.kbdHeightPx.portrait") ?? "-"}/${localStorage.getItem("td.kbdHeightPx.landscape") ?? "-"}`;
  } catch {
    return "-";
  }
}

/**
 * 键盘让位真机诊断浮层（临时，根因钉死后整体移除；对抗验证报告见
 * .dispatch/20260822-kbd-statemachine 的 P7「最小判别字段集」）。
 *
 * 只显示原始可测量：innerHeight / visualViewport / 实测遮挡 gap / 本实例 hook 输出 /
 * 键盘高缓存 / 插件事件流水。裁决点一眼可读：
 * - innerHeight 随键盘变 → 壳在动（overlay 前提失效，双倍避让候选 C5-2 命中）；
 * - visible=false 且 gap>0 → 收起后视口残影复活（悬空候选 C6-1 命中）；
 * - 流水里 willHide 缺失 → 事件丢失（候选 C6-2 命中）；
 * - kh 先跳缓存值再被 willShow 校正 → 预测抬升在场的时序证据。
 *
 * native 平台常显；web 平台需 localStorage 置 td.kbdDebug=1。pointer-events 关闭，
 * 不参与任何交互与布局，读数每次事件驱动刷新，无轮询。
 */
export function KeyboardDebugOverlay() {
  const [enabled] = useState(isEnabled);
  const keyboardHeight = useKeyboardHeight();
  const keyboardVisible = useKeyboardVisible();
  const [, setTick] = useState(0);
  const [log, setLog] = useState<DebugLogEntry[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const startedAt = Date.now();
    const push = (tag: string) => {
      const entry: DebugLogEntry = {
        t: Date.now() - startedAt,
        tag,
        ih: window.innerHeight,
        vvh: Math.round(window.visualViewport?.height ?? 0),
        gap: Math.round(readViewportBottomGap()),
      };
      setLog((prev) => [...prev.slice(-(LOG_LIMIT - 1)), entry]);
      setTick((n) => n + 1);
    };

    const onResize = () => push("rs");
    const onVvResize = () => push("vv");
    const onVvScroll = () => push("vs");
    const onFocusIn = () => push("fi");
    const onFocusOut = () => push("fo");
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onVvResize);
    window.visualViewport?.addEventListener("scroll", onVvScroll);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);

    let removeNative = () => {};
    if (Capacitor.getPlatform() !== "web") {
      try {
        // 插件缺席时 addListener 返回 rejected promise，同步 .catch 接住（与 useKeyboardHeight 同款）。
        const show = Keyboard.addListener("keyboardWillShow", (info) => {
          push(`WS${Math.round(info.keyboardHeight)}`);
        }).catch(() => null);
        const hide = Keyboard.addListener("keyboardWillHide", () => {
          push("WH");
        }).catch(() => null);
        removeNative = () => {
          void show.then((h) => h?.remove()).catch(() => {});
          void hide.then((h) => h?.remove()).catch(() => {});
        };
      } catch {
        // 旧桥同步抛：浮层只少插件流水，其余读数照常。
      }
    }

    push("mount");
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onVvResize);
      window.visualViewport?.removeEventListener("scroll", onVvScroll);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      removeNative();
    };
  }, [enabled]);

  if (!enabled) return null;

  const vv = window.visualViewport;
  return (
    <div
      data-testid="kbd-debug-overlay"
      className="td-safe-top pointer-events-none fixed left-0 top-0 max-w-60 rounded-br-ctl bg-page/80 p-1 td-text-caption text-ink-2"
      style={{ zIndex: Z.top }}
    >
      <div>
        ih:{window.innerHeight} vv:{Math.round(vv?.height ?? 0)}@{Math.round(vv?.offsetTop ?? 0)} gap:
        {Math.round(readViewportBottomGap())}
      </div>
      <div>
        kh:{Math.round(keyboardHeight)} vis:{keyboardVisible ? "T" : "F"} cache:{readCache()}
      </div>
      {log.map((entry) => (
        <div key={`${entry.t}-${entry.tag}`}>
          {entry.t}ms {entry.tag} ih{entry.ih} vv{entry.vvh} g{entry.gap}
        </div>
      ))}
    </div>
  );
}
