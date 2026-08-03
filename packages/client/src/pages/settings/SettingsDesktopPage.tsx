import { Trash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { ShortcutInput } from "../../components/desktop/ShortcutInput.js";
import { Icon } from "../../components/Icon.js";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";
import { Switch } from "../../components/ui/Switch.js";
import type {
  AutostartState,
  DesktopConfigDto,
  DesktopHotkeyBinding,
  RegistrationOutcome,
} from "../../lib/desktop/api.js";
import { invokeDesktop } from "../../lib/desktop/api.js";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

/**
 * 本页与桌面壳的唯一接触面。抽成参数而不是直接调模块函数，页面的全部数据流
 * （拉配置 / 存快捷键 / 切自启 / 改阈值 / 录入态挂起恢复）才能在 node 环境直测，
 * 组件本身只剩接线（形态同 DesktopBridge 的 punchFromHotkey）。
 */
export interface DesktopSettingsIo {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

export interface DesktopSettingsSnapshot {
  hotkeys: DesktopHotkeyBinding[];
  /** 输入框直接用的文本值（用户打到一半的中间态也得能显示，故不存 number）。 */
  confirmHours: string;
  autostart: AutostartState;
  outcomes: RegistrationOutcome[];
}

/**
 * 进页面一次性把三件事拉齐。热键状态走 resume_hotkeys 而不是只读配置：
 * 上一次录入若因切页/崩溃停在挂起态，全局热键会一直是注销的——开设置页顺手恢复，
 * 同时拿到「哪条注册失败、为什么」用于红字回显。
 */
export async function loadDesktopSettings(io: DesktopSettingsIo): Promise<DesktopSettingsSnapshot> {
  const [config, autostart, outcomes] = await Promise.all([
    io.invoke<DesktopConfigDto>("get_desktop_config"),
    io.invoke<AutostartState>("get_autostart_state"),
    io.invoke<RegistrationOutcome[]>("resume_hotkeys"),
  ]);
  return {
    hotkeys: config.hotkeys,
    confirmHours: String(config.punchConfirmHours),
    autostart,
    outcomes,
  };
}

/** 全量存盘并重注册。空快捷键行是「加了还没录」的草稿，不能当 accelerator 送去注册。 */
export async function saveHotkeys(
  hotkeys: DesktopHotkeyBinding[],
  io: DesktopSettingsIo,
): Promise<RegistrationOutcome[]> {
  const bindings = hotkeys.filter((binding) => binding.shortcut !== "");
  return io.invoke<RegistrationOutcome[]>("set_hotkeys", { bindings });
}

/**
 * 切自启。userDisabled 是「用户主动关过」的意图记录，Rust 的自启自愈靠它决定升级后要不要回弹，
 * 必须与 enabled 一起翻。IPC 失败照原样抛给调用方——系统没变却把开关显示成已切，
 * 用户要到下次开机才发现。
 */
export async function toggleAutostart(current: AutostartState, io: DesktopSettingsIo): Promise<AutostartState> {
  const enabled = !current.enabled;
  await io.invoke("set_autostart_enabled", { enabled });
  return { enabled, userDisabled: !enabled };
}

/** 录入态开关：进入时挂起全部全局热键，退出时恢复并带回注册结果。 */
export async function setRecordingHotkeys(
  recording: boolean,
  io: DesktopSettingsIo,
): Promise<RegistrationOutcome[] | null> {
  if (recording) {
    await io.invoke("suspend_hotkeys");
    return null;
  }
  return io.invoke<RegistrationOutcome[]>("resume_hotkeys");
}

/** 阈值落盘。Rust 对 <=0 / 非有限值一律返回 Err，前端先拦住，打到一半的输入不会每敲一下抛一次。 */
export async function saveConfirmHours(text: string, io: DesktopSettingsIo): Promise<number | null> {
  const hours = Number(text);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  await io.invoke("set_punch_confirm_hours", { hours });
  return hours;
}

/** 某条快捷键的注册失败原因；成功或压根没有对应结果时为 null。 */
export function registrationErrorOf(shortcut: string, outcomes: RegistrationOutcome[]): string | null {
  const outcome = outcomes.find((item) => item.shortcut === shortcut);
  if (!outcome || outcome.ok) return null;
  return outcome.error ?? "注册失败";
}

const DESKTOP_IO: DesktopSettingsIo = { invoke: invokeDesktop };

const ACTION_OPTIONS: { value: DesktopHotkeyBinding["action"]; label: string }[] = [
  { value: "punch", label: "打点" },
  { value: "toggleMain", label: "显示 / 隐藏窗口" },
];

/** 行身份：快捷键可以为空、可以重复，只有本地 rowId 能稳定标识一行（删中间行不错位）。 */
interface HotkeyRow extends DesktopHotkeyBinding {
  rowId: string;
}

function toRows(bindings: DesktopHotkeyBinding[], nextRowId: { current: number }): HotkeyRow[] {
  return bindings.map((binding) => ({ ...binding, rowId: `row-${nextRowId.current++}` }));
}

// Tauri 的 invoke 失败时 reject 的是字符串（Rust 的 Err(String)），不是 Error。
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function SettingsDesktopPage() {
  const [rows, setRows] = useState<HotkeyRow[]>([]);
  const [outcomes, setOutcomes] = useState<RegistrationOutcome[]>([]);
  const [autostart, setAutostart] = useState<AutostartState | null>(null);
  const [confirmHours, setConfirmHours] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nextRowId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await loadDesktopSettings(DESKTOP_IO);
        if (cancelled) return;
        setRows(toRows(snapshot.hotkeys, nextRowId));
        setConfirmHours(snapshot.confirmHours);
        setAutostart(snapshot.autostart);
        setOutcomes(snapshot.outcomes);
      } catch (err) {
        if (!cancelled) setError(messageOf(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateRow(rowId: string, patch: Partial<DesktopHotkeyBinding>) {
    setRows((prev) => prev.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }

  async function handleToggleAutostart() {
    if (!autostart) return;
    setError("");
    try {
      setAutostart(await toggleAutostart(autostart, DESKTOP_IO));
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function handleRecordingChange(recording: boolean) {
    try {
      const resumed = await setRecordingHotkeys(recording, DESKTOP_IO);
      if (resumed) setOutcomes(resumed);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      setOutcomes(await saveHotkeys(rows, DESKTOP_IO));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmHoursBlur() {
    setError("");
    try {
      await saveConfirmHours(confirmHours, DESKTOP_IO);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <SettingsDetailPage title="桌面设置">
      {error && (
        <p className="rounded-ctl border border-danger/50 bg-danger/10 p-2 td-text-caption text-danger">{error}</p>
      )}

      <section className="rounded-card border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="td-text-body font-semibold text-ink">开机自启</h2>
            <p className="mt-0.5 td-text-caption text-ink-3">
              在系统任务管理器里关掉会被下次升级改回来；要关请在这里关，这样升级后也不会自己回来。
            </p>
          </div>
          <Switch
            checked={autostart?.enabled ?? false}
            onChange={() => void handleToggleAutostart()}
            ariaLabel="开机自启"
            disabled={!autostart}
          />
        </div>
      </section>

      <section className="rounded-card border border-border bg-surface p-4">
        <h2 className="td-text-body font-semibold text-ink">全局快捷键</h2>
        <p className="mt-0.5 td-text-caption text-ink-3">任何时刻按下即触发，不用先把窗口切到前台。</p>
        {rows.length === 0 ? (
          <p className="mt-3 td-text-caption text-ink-3">还没有配置快捷键。</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {rows.map((row) => {
              const failure = registrationErrorOf(row.shortcut, outcomes);
              return (
                <li key={row.rowId} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShortcutInput
                      value={row.shortcut}
                      onChange={(shortcut) => updateRow(row.rowId, { shortcut })}
                      onRecordingChange={(recording) => void handleRecordingChange(recording)}
                    />
                    <SegmentedControl
                      options={ACTION_OPTIONS}
                      value={row.action}
                      onChange={(action) => updateRow(row.rowId, { action })}
                      ariaLabel="动作"
                      size="sm"
                      className="min-w-0 flex-1"
                    />
                    <button
                      type="button"
                      aria-label="删除"
                      onClick={() => setRows((prev) => prev.filter((item) => item.rowId !== row.rowId))}
                      className="shrink-0 rounded-ctl p-1.5 text-ink-3 transition-colors hover:bg-surface-hover hover:text-danger"
                    >
                      <Icon icon={Trash} size={18} />
                    </button>
                  </div>
                  {failure && <p className="td-text-caption text-danger">{failure}</p>}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, ...toRows([{ shortcut: "", action: "punch" }], nextRowId)])}
            className="rounded-ctl border border-border px-3 py-1.5 td-text-label text-ink-2 transition-colors hover:bg-surface-hover"
          >
            添加快捷键
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-ctl bg-accent px-3 py-1.5 td-text-label font-medium text-page transition-colors hover:bg-accent-strong disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存快捷键"}
          </button>
        </div>
      </section>

      <section className="rounded-card border border-border bg-surface p-4">
        <h2 className="td-text-body font-semibold text-ink">打点确认阈值</h2>
        <p className="mt-0.5 td-text-caption text-ink-3">
          距上次记录超过这么多小时时，先弹确认卡再落笔，防止同步没跑完就打出一整段假记录。
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={confirmHours}
            onChange={(e) => setConfirmHours(e.target.value)}
            onBlur={() => void handleConfirmHoursBlur()}
            aria-label="打点确认阈值（小时）"
            className="w-24 rounded-ctl border border-border bg-surface px-2 py-1.5 text-ink focus:border-accent focus:outline-none"
          />
          <span className="td-text-caption text-ink-3">小时</span>
        </div>
      </section>
    </SettingsDetailPage>
  );
}
