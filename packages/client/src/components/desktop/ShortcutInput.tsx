import { useState } from "react";

/**
 * 只取 KeyboardEvent 里用得上的那几个字段。原生 KeyboardEvent 与 React 合成事件都结构兼容它，
 * 而 node 环境没有 KeyboardEvent 构造器——按结构收参，规范化逻辑才能不起 DOM 直测。
 *
 * `code` 是**键位**（哪个物理键），`key` 是**字符**（按下它产出什么）。主键必须走 code，见下。
 */
export interface ShortcutKeyEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);
/** F1–F24 允许裸键：它们不参与打字，单独按下不会误触发。 */
const BARE_ALLOWED = /^F([1-9]|1\d|2[0-4])$/;

/**
 * `code` → Tauri accelerator 的主键名。认不出的 code 返回 null，交给 `key` 那条兜底。
 *
 * 名字取「短的那个别名」（`Digit1` → `1`、`KeyP` → `P`、`ArrowUp` → `Up`）：accelerator
 * 解析器两种都收，但存进配置的串会原样显示在设置页的按钮上，也要与批 2 之前存下的串兼容。
 */
function mainKeyFromCode(code: string): string | null {
  if (/^Digit\d$/.test(code)) return code.slice(5); // Digit1 → 1
  if (/^Key[A-Z]$/.test(code)) return code.slice(3); // KeyP → P
  if (/^Numpad\d$/.test(code)) return code; // Numpad1（解析器认 NUMPAD1）
  if (/^Arrow(Up|Down|Left|Right)$/.test(code)) return code.slice(5); // ArrowUp → Up
  if (BARE_ALLOWED.test(code)) return code; // F1–F24
  if (["Space", "Home", "End", "PageUp", "PageDown", "Insert", "Delete", "Backspace", "Enter"].includes(code)) {
    return code;
  }
  // 标点键：code 是键位名（Minus / Equal / Semicolon …），解析器同样收。
  if (["Minus", "Equal", "Semicolon", "Quote", "Comma", "Period", "Slash", "Backslash", "Backquote"].includes(code)) {
    return code;
  }
  if (code === "BracketLeft" || code === "BracketRight") return code;
  return null;
}

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
 *
 * **主键取 `e.code`（键位）而不是 `e.key`（字符）**：上档时 `key` 拿到的是字符，
 * `Ctrl+Shift+1` 会被录成 `Ctrl+Shift+!`、`Ctrl+Shift+=` 录成 `Ctrl+Shift++`、
 * `Ctrl+Shift+;` 录成 `Ctrl+Shift+:`，非拉丁布局下 AltGr 还会合成出别的字符。
 * 这些串 Tauri 的 accelerator 解析器一个都不认——非法绑定被持久化后，每次启动白重试一次，
 * 用户只看到「这个热键没反应」。code 与解析器同源（它认的就是 KeyboardEvent 的 code 名字）。
 * code 缺失（合成事件、老浏览器）时退回 key，行为不比从前差。
 */
export function normalizeShortcutFromKeyboardEvent(e: ShortcutKeyEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const main = (e.code ? mainKeyFromCode(e.code) : null) ?? normalizeMainKey(e.key);
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  // 字母/数字必须带修饰键——裸键会让正常打字触发全局动作；F 键例外。
  if (mods.length === 0 && !BARE_ALLOWED.test(main)) return null;
  return [...mods, main].join("+");
}

/** 按了个不能当快捷键的组合时，就地把原因说清楚——否则界面停在「按下组合键…」，
 *  用户以为录上了，保存后那行被静默丢弃、热键从未生效。 */
const INVALID_HINT = "要带 Ctrl / Alt / Shift";

/**
 * 快捷键录入：聚焦即进入录入态，按下组合直接录完，Esc 取消。
 * onRecordingChange 给页面挂起/恢复全局热键用——不挂起的话，录一个本应用已注册的组合时
 * 按键会被全局热键吃掉、永远录不上；挂起了不恢复则按一次 Esc 全局热键就永久失效。
 */
export function ShortcutInput({
  value,
  onChange,
  onRecordingChange,
  ariaDescribedby,
  ariaInvalid,
}: {
  value: string;
  onChange: (shortcut: string) => void;
  onRecordingChange: (recording: boolean) => void;
  /** 出错时指向那条红字的 id：红字挨着控件是**视觉**关联，读屏要靠它才知道这话在说谁。 */
  ariaDescribedby?: string;
  ariaInvalid?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [invalid, setInvalid] = useState(false);

  function setRecordingState(next: boolean) {
    setRecording(next);
    setInvalid(false);
    onRecordingChange(next);
  }

  // 读屏取可访问名时 aria-label 会**盖掉**按钮的 text content。写死一个「快捷键」的话，
  // 读出来永远是「快捷键，按钮」——当前绑的是什么、是不是正在录、录失败没有，一概听不出来。
  const label = recording
    ? invalid
      ? `快捷键：${INVALID_HINT}，请重按`
      : "快捷键：正在录入，请按组合键"
    : value
      ? `快捷键：${value}`
      : "快捷键：未设置";

  return (
    <button
      type="button"
      aria-label={label}
      aria-describedby={ariaDescribedby}
      aria-invalid={ariaInvalid}
      onFocus={() => setRecordingState(true)}
      onBlur={() => setRecordingState(false)}
      onKeyDown={(e) => {
        if (!recording) return;
        // Tab / Shift+Tab 先放行再说：下面那句 preventDefault 会把它一起吃掉，
        // 键盘用户进得来出不去，只能按 Esc 跳到 body 再从头 Tab。
        if (e.key === "Tab") return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          e.currentTarget.blur();
          return;
        }
        // 纯修饰键按下是「还在按」，不是失败，不要提示。
        if (MODIFIER_KEYS.has(e.key)) return;
        const shortcut = normalizeShortcutFromKeyboardEvent(e.nativeEvent);
        if (shortcut) {
          setInvalid(false);
          onChange(shortcut);
          e.currentTarget.blur();
          return;
        }
        setInvalid(true);
      }}
      className={`min-w-32 shrink-0 rounded-ctl border px-3 py-1.5 text-left td-text-label transition-colors ${
        recording
          ? invalid
            ? "border-danger bg-danger/10 text-danger"
            : "border-accent bg-accent-soft text-ink"
          : "border-border bg-surface text-ink-2 hover:bg-surface-hover"
      }`}
    >
      {recording ? (invalid ? INVALID_HINT : "按下组合键…") : value || "点击录入"}
    </button>
  );
}
