import { Trash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { ShortcutInput } from "../../components/desktop/ShortcutInput.js";
import { Icon } from "../../components/Icon.js";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";
import { SelectSheet } from "../../components/ui/SelectSheet.js";
import { StatusBanner } from "../../components/ui/StatusBanner.js";
import { Switch } from "../../components/ui/Switch.js";
import type {
  AutostartState,
  DesktopConfigDto,
  DesktopHotkeyBinding,
  RegistrationOutcome,
} from "../../lib/desktop/api.js";
import { invokeDesktop, messageOf } from "../../lib/desktop/api.js";
import { isMainNavRoute, MAIN_NAV_ITEMS } from "../../lib/navigation/navRegistry.js";
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

/** 送去注册的那些行：空快捷键行是「加了还没录」的草稿，不能当 accelerator 送出去。 */
export function bindingsToRegister(hotkeys: DesktopHotkeyBinding[]): DesktopHotkeyBinding[] {
  return hotkeys.filter((binding) => binding.shortcut !== "");
}

/**
 * 空行被跳过时给一句可见的话。**不能静默 filter**：用户按了个非法组合以为录上了 → 保存 →
 * 那行被无声丢弃 → 无红字、行还在原地 → 认定保存成功；退出再进设置页，行消失，热键从未生效。
 */
export function skippedRowsNotice(hotkeys: DesktopHotkeyBinding[]): string | null {
  const skipped = hotkeys.length - bindingsToRegister(hotkeys).length;
  return skipped === 0 ? null : `有 ${skipped} 行还没录快捷键，已跳过——录上组合再保存才会生效。`;
}

/** 全量存盘并重注册。 */
export async function saveHotkeys(
  hotkeys: DesktopHotkeyBinding[],
  io: DesktopSettingsIo,
): Promise<RegistrationOutcome[]> {
  return io.invoke<RegistrationOutcome[]>("set_hotkeys", { bindings: bindingsToRegister(hotkeys) });
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

/**
 * 阈值落盘。Rust 对 <=0 / 非有限值一律返回 Err，前端先拦住不发 IPC（挂在 onBlur 上，
 * 本来就只在离开输入框时触发一次；拦住是为了不拿必然失败的值去打一趟 IPC 再把 Rust 的
 * 报错原样糊到页面上）。**返回 null 表示「没保存」，调用方必须处理**——不处理的话
 * 输入框停在 0，用户以为「从此每次都弹确认卡」，实际仍是旧值，3 小时的区间照样闷头写。
 * IPC 真失败时照原样抛给调用方，不假报成功。
 */
export async function saveConfirmHours(text: string, io: DesktopSettingsIo): Promise<number | null> {
  const hours = Number(text);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  await io.invoke("set_punch_confirm_hours", { hours });
  return hours;
}

/**
 * 把注册结果**按下标**贴回每一行。
 *
 * 不能按 shortcut 字符串 find：快捷键可以重复（两行都录 `Ctrl+Alt+P`，一行打点一行切窗口），
 * 那时两行都会 find 到第一条（ok）→ 真正注册失败的第二行**不显示红字**，用户按下只会打点、
 * 切窗口永远不响应，页面上没有任何解释。`apply_bindings` 返回的数组与送出的 bindings
 * 下标对齐，而 bindings = 过滤掉空行后的 rows——照这个顺序贴回去。
 *
 * 贴回前还要比对 shortcut：行被改过但还没保存时，上一次的结果已经不是这一行的结果了
 * （壳里注册着的仍是旧绑定，这一点由「未保存」标记去说，不靠红字）。
 */
export function outcomesForRows(
  hotkeys: DesktopHotkeyBinding[],
  outcomes: RegistrationOutcome[],
): (RegistrationOutcome | null)[] {
  let next = 0;
  return hotkeys.map((row) => {
    if (row.shortcut === "") return null; // 空行没送出去，也就没有对应结果
    const outcome = outcomes[next++] ?? null;
    return outcome && outcome.shortcut === row.shortcut ? outcome : null;
  });
}

/** 某条快捷键的注册失败原因；成功或压根没有对应结果时为 null。 */
export function registrationErrorOf(outcome: RegistrationOutcome | null): string | null {
  if (!outcome || outcome.ok) return null;
  return outcome.error ?? "注册失败";
}

const DESKTOP_IO: DesktopSettingsIo = { invoke: invokeDesktop };

const ACTION_OPTIONS: { value: DesktopHotkeyBinding["action"]; label: string }[] = [
  { value: "punch", label: "打点" },
  { value: "toggleMain", label: "显示 / 隐藏窗口" },
  { value: "capture", label: "速记浮窗" },
  { value: "navigate", label: "跳转" },
];

/** 行身份：快捷键可以为空、可以重复，只有本地 rowId 能稳定标识一行（删中间行不错位）。 */
export interface HotkeyRow extends DesktopHotkeyBinding {
  rowId: string;
}

/**
 * 目标页选项 = 主导航表，零维护：以后给 app 加一个主导航页，这里自动多一项。
 * 不另维护一张桌面专用表——那张表加页面时漏改不会有任何东西报红。
 */
export const NAV_TARGET_OPTIONS: { value: string; label: string }[] = MAIN_NAV_ITEMS.map((item) => ({
  value: item.to,
  label: item.label,
}));

/**
 * 换动作时顺带把 target 摆正：切到 navigate 补默认值，切走则清掉。
 *
 * 补默认值不是顺手——留空存下去，Rust 解析时缺 target 会把整条绑定跳过，用户看着保存成功、
 * 热键却凭空没了，一条测试都不会红。切走时清掉则是免得非 navigate 动作带着无意义的残留字段落盘。
 *
 * 切走再切回**必然落回默认页**：切走那一步已经把 target 清成 `undefined`，`??` 的左分支
 * 在真实 UI 流里不可达，只为防御非 UI 来源的 row。
 * 默认值取 `MAIN_NAV_ITEMS[0]`，即**主导航表的第一项**——那张表是按侧边栏展示顺序排的，
 * 重排导航表会静默改变这里的默认目标页。
 */
export function applyActionChange(
  row: HotkeyRow,
  action: DesktopHotkeyBinding["action"],
): Partial<DesktopHotkeyBinding> {
  if (action !== "navigate") return { action, target: undefined };
  return { action, target: row.target ?? MAIN_NAV_ITEMS[0].to };
}

/** 目标页不在白名单里时的可见提示。存量绑定会因上游路由改名落到这里。 */
export function navTargetErrorOf(row: HotkeyRow): string | null {
  if (row.action !== "navigate") return null;
  if (row.target && isMainNavRoute(row.target)) return null;
  return `目标页「${row.target ?? ""}」不存在，重新选一个`;
}

function toRows(bindings: DesktopHotkeyBinding[], nextRowId: { current: number }): HotkeyRow[] {
  return bindings.map((binding) => ({ ...binding, rowId: `row-${nextRowId.current++}` }));
}

export default function SettingsDesktopPage() {
  const [rows, setRows] = useState<HotkeyRow[]>([]);
  const [outcomes, setOutcomes] = useState<RegistrationOutcome[]>([]);
  const [autostart, setAutostart] = useState<AutostartState | null>(null);
  const [confirmHours, setConfirmHours] = useState("");
  /** 最后一次**存住了**的阈值。非法输入回退到它，而不是把 0 留在框里假装保存过。 */
  const [savedHours, setSavedHours] = useState("");
  const [saving, setSaving] = useState(false);
  /** 快捷键表改过但还没保存。改动不保存就离开的话，壳里注册着的仍是旧表，
   *  而且再聚焦任意录入框会 resume_hotkeys 按磁盘配置重装，把「删掉」的那条装回来。 */
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const nextRowId = useRef(0);

  /**
   * 录入态的挂起 / 恢复串成一条链。两行之间移焦点时 DOM 先发 blur（resume：读文件 + 逐条注册）
   * 再发 focus（suspend：只 unregister_all），fire-and-forget 的话完成顺序无保证：
   * suspend 先完成、resume 后完成时，**第二行正处于录入态而全局热键是注册着的**——
   * 按下已注册的组合会触发打点而不是被录进去，正是挂起逻辑要防的那件事。
   */
  const recordingQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await loadDesktopSettings(DESKTOP_IO);
        if (cancelled) return;
        setRows(toRows(snapshot.hotkeys, nextRowId));
        setConfirmHours(snapshot.confirmHours);
        setSavedHours(snapshot.confirmHours);
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

  // 离开本页时无条件恢复全局热键。挂起挂在 focus、恢复挂在 blur，而 React **卸载一个正在
  // 聚焦的元素不触发 blur**：进设置 → 点录入框 → 按返回，全部热键就此失效，直到再进一次
  // 设置页或重启壳。批 2 的全部价值就是这些热键，这条不能只靠 blur。
  useEffect(() => {
    return () => {
      recordingQueue.current = recordingQueue.current.then(async () => {
        try {
          await DESKTOP_IO.invoke("resume_hotkeys");
        } catch {
          // 页面已经卸载了，没有回显的地方；恢复不了也不该把卸载搞崩。
        }
      });
    };
  }, []);

  function updateRow(rowId: string, patch: Partial<DesktopHotkeyBinding>) {
    setRows((prev) => prev.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
    setDirty(true);
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

  function handleRecordingChange(recording: boolean) {
    recordingQueue.current = recordingQueue.current.then(async () => {
      try {
        const resumed = await setRecordingHotkeys(recording, DESKTOP_IO);
        if (resumed) setOutcomes(resumed);
      } catch (err) {
        setError(messageOf(err));
      }
    });
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setHint(skippedRowsNotice(rows) ?? "");
    try {
      setOutcomes(await saveHotkeys(rows, DESKTOP_IO));
      setDirty(false);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmHoursBlur() {
    setError("");
    try {
      const saved = await saveConfirmHours(confirmHours, DESKTOP_IO);
      if (saved === null) {
        // 非法值一个字都没存。回退显示值并说清楚，否则框里留着 0，用户以为「从此每次
        // 都弹确认卡」，实际仍是旧值，3 小时的区间照样闷头写。
        setConfirmHours(savedHours);
        setError(`阈值要是大于 0 的小时数，已改回 ${savedHours}`);
        return;
      }
      setSavedHours(String(saved));
    } catch (err) {
      setConfirmHours(savedHours);
      setError(messageOf(err));
    }
  }

  // 注册结果按下标贴回行（快捷键可以重复，字符串 find 会让失败那行不显示红字）。
  const rowOutcomes = outcomesForRows(rows, outcomes);

  return (
    <SettingsDetailPage title="桌面设置">
      {error && <StatusBanner tone="danger">{error}</StatusBanner>}
      {hint && (
        <p className="rounded-ctl border border-border bg-surface-hover p-2 td-text-caption text-ink-2">{hint}</p>
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
            {rows.map((row, index) => {
              const failure = registrationErrorOf(rowOutcomes[index]);
              const navTargetError = navTargetErrorOf(row);
              return (
                <li key={row.rowId} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShortcutInput
                      value={row.shortcut}
                      onChange={(shortcut) => updateRow(row.rowId, { shortcut })}
                      onRecordingChange={handleRecordingChange}
                    />
                    <SegmentedControl
                      options={ACTION_OPTIONS}
                      value={row.action}
                      onChange={(action) => updateRow(row.rowId, applyActionChange(row, action))}
                      ariaLabel="动作"
                      size="sm"
                      className="min-w-0 flex-1"
                    />
                    {row.action === "navigate" && (
                      <SelectSheet
                        options={NAV_TARGET_OPTIONS}
                        value={row.target ?? null}
                        onChange={(target) => updateRow(row.rowId, { target })}
                        label="目标页"
                        placeholder="选一个页面"
                        className="min-w-0 flex-1"
                      />
                    )}
                    <button
                      type="button"
                      aria-label="删除"
                      onClick={() => {
                        setRows((prev) => prev.filter((item) => item.rowId !== row.rowId));
                        setDirty(true);
                      }}
                      className="shrink-0 rounded-ctl p-1.5 text-ink-3 transition-colors hover:bg-surface-hover hover:text-danger"
                    >
                      <Icon icon={Trash} size={18} />
                    </button>
                  </div>
                  {failure && <p className="td-text-caption text-danger">{failure}</p>}
                  {navTargetError && <p className="td-text-caption text-danger">{navTargetError}</p>}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setRows((prev) => [...prev, ...toRows([{ shortcut: "", action: "punch" }], nextRowId)]);
              setDirty(true);
            }}
            className="rounded-ctl border border-border px-3 py-1.5 td-text-label text-ink-2 transition-colors hover:bg-surface-hover"
          >
            添加快捷键
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !dirty}
            className="rounded-ctl bg-accent px-3 py-1.5 td-text-label font-medium text-page transition-colors hover:bg-accent-strong disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存快捷键"}
          </button>
          {dirty && <span className="td-text-caption text-ink-3">改动要保存才生效</span>}
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
