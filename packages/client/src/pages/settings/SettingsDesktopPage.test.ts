import { describe, expect, it, vi } from "vitest";
import type { AutostartState, DesktopConfigDto, RegistrationOutcome } from "../../lib/desktop/api.js";
import {
  type DesktopSettingsIo,
  loadDesktopSettings,
  registrationErrorOf,
  saveConfirmHours,
  saveHotkeys,
  setRecordingHotkeys,
  toggleAutostart,
} from "./SettingsDesktopPage.js";

// 四个来源的取值故意两两不同：任何一处「从别的命令的返回值里取字段」都会当场对不上。
const CONFIG: DesktopConfigDto = {
  autostartDisabled: false,
  punchConfirmHours: 2.5,
  hotkeys: [{ shortcut: "Ctrl+Alt+P", action: "punch" }],
};
const AUTOSTART: AutostartState = { enabled: true, userDisabled: false };
const RESUMED: RegistrationOutcome[] = [
  { shortcut: "Ctrl+Alt+P", action: "punch", ok: false, error: "被其他程序占用" },
];
const SAVED: RegistrationOutcome[] = [{ shortcut: "Ctrl+Alt+M", action: "toggleMain", ok: true, error: null }];

function makeIo() {
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd === "get_desktop_config") return CONFIG;
    if (cmd === "get_autostart_state") return AUTOSTART;
    if (cmd === "resume_hotkeys") return RESUMED;
    if (cmd === "set_hotkeys") return SAVED;
    return undefined;
  });
  const io = { invoke } as unknown as DesktopSettingsIo;
  return { io, invoke };
}

describe("loadDesktopSettings", () => {
  it("三条命令都发，且每个字段取自它该来的那条命令", async () => {
    const { io, invoke } = makeIo();

    const snapshot = await loadDesktopSettings(io);

    expect(invoke).toHaveBeenCalledWith("get_desktop_config");
    expect(invoke).toHaveBeenCalledWith("get_autostart_state");
    expect(invoke).toHaveBeenCalledWith("resume_hotkeys");
    expect(snapshot.hotkeys).toEqual(CONFIG.hotkeys);
    expect(snapshot.confirmHours).toBe("2.5");
    expect(snapshot.autostart).toEqual(AUTOSTART);
    expect(snapshot.outcomes).toEqual(RESUMED);
  });

  // 进页面必须走 resume 而不是只读配置：上一次录入若因崩溃/切页停在挂起态，
  // 全局热键就一直是注销的；开设置页顺手恢复，同时拿到「哪条注册失败」用于红字回显。
  it("注册结果来自 resume_hotkeys（不是配置里的 hotkeys）", async () => {
    const { io } = makeIo();

    const snapshot = await loadDesktopSettings(io);

    expect(snapshot.outcomes).toHaveLength(1);
    expect(snapshot.outcomes[0].ok).toBe(false);
    expect(snapshot.outcomes[0].error).toBe("被其他程序占用");
  });
});

describe("saveHotkeys", () => {
  it("参数名是 bindings（Rust set_hotkeys 的形参），返回值即注册结果", async () => {
    const { io, invoke } = makeIo();
    const bindings: DesktopConfigDto["hotkeys"] = [{ shortcut: "Ctrl+Alt+M", action: "toggleMain" }];

    const outcomes = await saveHotkeys(bindings, io);

    expect(invoke).toHaveBeenCalledWith("set_hotkeys", { bindings });
    expect(outcomes).toEqual(SAVED);
  });

  // 「添加快捷键」先落一个空行，用户还没录就点保存的话，空串会被当成一条 accelerator 送去注册，
  // Rust 侧必然报错、红字回显还没有行能挂。空行是未完成的草稿，压根不该出门。
  it("没录入的空行不发给 Rust", async () => {
    const { io, invoke } = makeIo();

    await saveHotkeys(
      [
        { shortcut: "Ctrl+Alt+P", action: "punch" },
        { shortcut: "", action: "toggleMain" },
      ],
      io,
    );

    expect(invoke).toHaveBeenCalledWith("set_hotkeys", { bindings: [{ shortcut: "Ctrl+Alt+P", action: "punch" }] });
  });
});

describe("toggleAutostart", () => {
  // userDisabled 是「用户主动关过」的意图记录，Rust 的自启自愈逻辑靠它决定升级后要不要回弹。
  // 只翻 enabled 不翻 userDisabled，页面下次进来就会把已关闭显示成"系统关的、可以自动恢复"。
  it("从开到关：发 enabled:false，同时把用户关闭意图记下来", async () => {
    const { io, invoke } = makeIo();

    const next = await toggleAutostart({ enabled: true, userDisabled: false }, io);

    expect(invoke).toHaveBeenCalledWith("set_autostart_enabled", { enabled: false });
    expect(next).toEqual({ enabled: false, userDisabled: true });
  });

  it("从关到开：发 enabled:true，用户关闭意图一并清掉", async () => {
    const { io, invoke } = makeIo();

    const next = await toggleAutostart({ enabled: false, userDisabled: true }, io);

    expect(invoke).toHaveBeenCalledWith("set_autostart_enabled", { enabled: true });
    expect(next).toEqual({ enabled: true, userDisabled: false });
  });

  // Rust 侧 enable/disable 失败会返回 Err（注册表写不进去、意图落盘失败等）。
  // 吞掉它就等于开关"看起来切了"而系统没变，用户下次开机才发现——错误必须往上抛，页面照原样展示。
  it("IPC 失败时把错误抛给调用方，不假报切换成功", async () => {
    const { io, invoke } = makeIo();
    invoke.mockRejectedValueOnce(new Error("自启已开启，但关闭意图记录失败：拒绝访问"));

    await expect(toggleAutostart({ enabled: false, userDisabled: true }, io)).rejects.toThrow("拒绝访问");
  });
});

describe("setRecordingHotkeys", () => {
  // 录入态不挂起全局热键，录一个本应用已注册的组合时按键会被全局热键吃掉，永远录不上。
  it("进入录入态挂起全部全局热键", async () => {
    const { io, invoke } = makeIo();

    const outcomes = await setRecordingHotkeys(true, io);

    expect(invoke).toHaveBeenCalledWith("suspend_hotkeys");
    expect(invoke).not.toHaveBeenCalledWith("resume_hotkeys");
    expect(outcomes).toBeNull();
  });

  it("退出录入态恢复注册并带回注册结果", async () => {
    const { io, invoke } = makeIo();

    const outcomes = await setRecordingHotkeys(false, io);

    expect(invoke).toHaveBeenCalledWith("resume_hotkeys");
    expect(invoke).not.toHaveBeenCalledWith("suspend_hotkeys");
    expect(outcomes).toEqual(RESUMED);
  });
});

describe("saveConfirmHours", () => {
  it("合法小时数落盘，参数名是 hours 且是数字", async () => {
    const { io, invoke } = makeIo();

    expect(await saveConfirmHours("2.5", io)).toBe(2.5);
    expect(invoke).toHaveBeenCalledWith("set_punch_confirm_hours", { hours: 2.5 });
  });

  // Rust 侧对 <=0 / 非有限值一律返回 Err；前端先拦住，输入框里打了半截字不会每敲一下就抛一次。
  it("非法输入一律不发 IPC", async () => {
    for (const text of ["", "abc", "0", "-1"]) {
      const { io, invoke } = makeIo();
      expect(await saveConfirmHours(text, io)).toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    }
  });
});

describe("registrationErrorOf", () => {
  it("注册失败的行回显 Rust 给的原因", () => {
    expect(registrationErrorOf("Ctrl+Alt+P", RESUMED)).toBe("被其他程序占用");
  });

  it("失败但没给原因时仍要报失败，不许静默当成功", () => {
    expect(
      registrationErrorOf("Ctrl+Alt+P", [{ shortcut: "Ctrl+Alt+P", action: "punch", ok: false, error: null }]),
    ).toBe("注册失败");
  });

  it("注册成功或没有对应结果时不报错", () => {
    expect(registrationErrorOf("Ctrl+Alt+M", SAVED)).toBeNull();
    expect(registrationErrorOf("Ctrl+Alt+X", RESUMED)).toBeNull();
  });
});
