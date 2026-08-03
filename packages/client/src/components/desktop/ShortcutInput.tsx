import { useState } from "react";

/**
 * 只取 KeyboardEvent 里用得上的那几个字段。原生 KeyboardEvent 与 React 合成事件都结构兼容它，
 * 而 node 环境没有 KeyboardEvent 构造器——按结构收参，规范化逻辑才能不起 DOM 直测。
 */
export interface ShortcutKeyEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);
/** F1–F24 允许裸键：它们不参与打字，单独按下不会误触发。 */
const BARE_ALLOWED = /^F([1-9]|1\d|2[0-4])$/;

function normalizeMainKey(key: string): string {
  if (key === " ") return "Space";
  if (key.startsWith("Arrow")) return key.slice(5); // ArrowUp → Up
  if (key.length === 1) return key.toUpperCase();
  return key; // F1–F24 / Home / End / PageUp…（与 Tauri accelerator 同名）
}

/**
 * KeyboardEvent → Tauri accelerator（如 "Ctrl+Alt+P"）。不合法（裸字母/数字、纯修饰键）返回 null。
 * 修饰键顺序由本函数钉死（Ctrl→Alt→Shift→Super），与用户按下的先后无关：
 * 存进配置的字符串必须与回显时用来匹配注册结果的字符串逐字一致。
 */
export function normalizeShortcutFromKeyboardEvent(e: ShortcutKeyEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const main = normalizeMainKey(e.key);
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  // 字母/数字必须带修饰键——裸键会让正常打字触发全局动作；F 键例外。
  if (mods.length === 0 && !BARE_ALLOWED.test(main)) return null;
  return [...mods, main].join("+");
}

/**
 * 快捷键录入：聚焦即进入录入态，按下组合直接录完，Esc 取消。
 * onRecordingChange 给页面挂起/恢复全局热键用——不挂起的话，录一个本应用已注册的组合时
 * 按键会被全局热键吃掉、永远录不上；挂起了不恢复则按一次 Esc 全局热键就永久失效。
 */
export function ShortcutInput({
  value,
  onChange,
  onRecordingChange,
}: {
  value: string;
  onChange: (shortcut: string) => void;
  onRecordingChange: (recording: boolean) => void;
}) {
  const [recording, setRecording] = useState(false);

  function setRecordingState(next: boolean) {
    setRecording(next);
    onRecordingChange(next);
  }

  return (
    <button
      type="button"
      aria-label="快捷键"
      onFocus={() => setRecordingState(true)}
      onBlur={() => setRecordingState(false)}
      onKeyDown={(e) => {
        if (!recording) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          e.currentTarget.blur();
          return;
        }
        const shortcut = normalizeShortcutFromKeyboardEvent(e.nativeEvent);
        if (shortcut) {
          onChange(shortcut);
          e.currentTarget.blur();
        }
      }}
      className={`min-w-32 shrink-0 rounded-ctl border px-3 py-1.5 text-left td-text-label transition-colors ${
        recording
          ? "border-accent bg-accent-soft text-ink"
          : "border-border bg-surface text-ink-2 hover:bg-surface-hover"
      }`}
    >
      {recording ? "按下组合键…" : value || "点击录入"}
    </button>
  );
}
