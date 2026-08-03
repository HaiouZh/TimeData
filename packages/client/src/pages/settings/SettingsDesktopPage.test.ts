import { describe, expect, it, vi } from "vitest";
import type { AutostartState, DesktopConfigDto, RegistrationOutcome } from "../../lib/desktop/api.js";
import {
  type DesktopSettingsIo,
  loadDesktopSettings,
  outcomesForRows,
  registrationErrorOf,
  saveConfirmHours,
  saveHotkeys,
  setRecordingHotkeys,
  skippedRowsNotice,
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
  // 它由 Rust 从 enabled 推出来写进 desktop-config.json，本函数只是把返回的快照跟着翻，
  // **让页面手里那份状态与磁盘上那份不分家**——原注释说「页面下次进来会把已关闭显示成
  // 『系统关的』」是不成立的：页面只读 enabled，副文案是静态串，重进页面走的是
  // get_autostart_state 重新拉。这条守的是「本地快照不许与刚发出去的意图相反」。
  it("从开到关：发 enabled:false，本地快照的关闭意图跟着翻", async () => {
    const { io, invoke } = makeIo();

    const next = await toggleAutostart({ enabled: true, userDisabled: false }, io);

    expect(invoke).toHaveBeenCalledWith("set_autostart_enabled", { enabled: false });
    expect(next).toEqual({ enabled: false, userDisabled: true });
  });

  it("从关到开：发 enabled:true，本地快照的关闭意图一并清掉", async () => {
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

  // Rust 侧对 <=0 / 非有限值一律返回 Err；前端先拦住，不拿必然失败的值去打一趟 IPC。
  // 返回 null = 「没保存」，调用方必须据此回退显示值（否则框里留着 0，用户以为阈值改了）。
  it("非法输入一律不发 IPC，且返回 null 告诉调用方没保存", async () => {
    for (const text of ["", "abc", "0", "-1"]) {
      const { io, invoke } = makeIo();
      expect(await saveConfirmHours(text, io)).toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    }
  });

  // 与同文件 toggleAutostart 那条对称：IPC 失败要抛给调用方，不许假报成功。
  // 吞掉它就是「页面显示改了、磁盘上还是旧阈值」，下次超阈值该弹的卡不弹。
  it("IPC 失败时把错误抛给调用方，不假报保存成功", async () => {
    const { io, invoke } = makeIo();
    invoke.mockRejectedValueOnce("替换配置文件 C:/x/desktop-config.json 失败: 拒绝访问");

    await expect(saveConfirmHours("2.5", io)).rejects.toThrow(/拒绝访问/);
  });
});

describe("registrationErrorOf", () => {
  it("注册失败的行回显 Rust 给的原因", () => {
    expect(registrationErrorOf(RESUMED[0])).toBe("被其他程序占用");
  });

  it("失败但没给原因时仍要报失败，不许静默当成功", () => {
    expect(registrationErrorOf({ shortcut: "Ctrl+Alt+P", action: "punch", ok: false, error: null })).toBe("注册失败");
  });

  it("注册成功或没有对应结果时不报错", () => {
    expect(registrationErrorOf(SAVED[0])).toBeNull();
    expect(registrationErrorOf(null)).toBeNull();
  });
});

// 按 shortcut 字符串 find 的写法在「两行绑同一组合」时会让两行都命中第一条（ok）——
// 真正注册失败的那行不显示红字，用户按下只会打点、切窗口永远不响应，页面上没有任何解释。
// 而文档 §8「热键没反应」把用户指向的正是这行红字。
describe("outcomesForRows：注册结果按下标贴回行", () => {
  const DUP: DesktopConfigDto["hotkeys"] = [
    { shortcut: "Ctrl+Alt+P", action: "punch" },
    { shortcut: "Ctrl+Alt+P", action: "toggleMain" },
  ];
  const DUP_OUTCOMES: RegistrationOutcome[] = [
    { shortcut: "Ctrl+Alt+P", action: "punch", ok: true, error: null },
    { shortcut: "Ctrl+Alt+P", action: "toggleMain", ok: false, error: "被其他程序占用" },
  ];

  it("两行绑同一快捷键时，失败的是第二行就红在第二行", () => {
    const attached = outcomesForRows(DUP, DUP_OUTCOMES);
    expect(registrationErrorOf(attached[0])).toBeNull();
    expect(registrationErrorOf(attached[1])).toBe("被其他程序占用");
  });

  it("空行没送出去，也就不占结果下标（后面的行不许错位）", () => {
    const rows: DesktopConfigDto["hotkeys"] = [
      { shortcut: "", action: "punch" },
      { shortcut: "Ctrl+Alt+P", action: "punch" },
    ];
    const attached = outcomesForRows(rows, [
      { shortcut: "Ctrl+Alt+P", action: "punch", ok: false, error: "被其他程序占用" },
    ]);
    expect(attached[0]).toBeNull();
    expect(registrationErrorOf(attached[1])).toBe("被其他程序占用");
  });

  it("行改过还没保存时不显示上一次的结果（壳里注册着的还是旧绑定，由未保存标记去说）", () => {
    const attached = outcomesForRows([{ shortcut: "Ctrl+Alt+K", action: "punch" }], RESUMED);
    expect(attached[0]).toBeNull();
  });
});

// 空行被静默 filter 掉时：用户按了个非法组合以为录上了 → 保存 → 那行被无声丢弃 →
// 无红字、行还在原地 → 认定保存成功；退出再进设置页，行消失，热键从未生效。
describe("skippedRowsNotice", () => {
  it("有空行就给一句可见的话，说清它没生效", () => {
    const notice = skippedRowsNotice([
      { shortcut: "Ctrl+Alt+P", action: "punch" },
      { shortcut: "", action: "toggleMain" },
    ]);
    expect(notice).toContain("1 行");
    expect(notice).toContain("没录");
  });

  it("全都录了就不啰嗦", () => {
    expect(skippedRowsNotice([{ shortcut: "Ctrl+Alt+P", action: "punch" }])).toBeNull();
  });
});
