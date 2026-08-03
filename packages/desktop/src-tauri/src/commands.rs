//! 前端 IPC 命令面与热键注册装配。
//!
//! 本文件是系统调用薄层：可判定逻辑（配置解析、排队状态机、toggle 真值表）
//! 已在 config.rs / hotkeys.rs / shell.rs 各自测完，这里只做装配，不再写单测。

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;

use crate::config::{self, action_id, DesktopConfig, HotkeyAction, HotkeyBinding};
use crate::hotkeys::{HotkeyDispatcher, HotkeyEventPayload, RegistrationOutcome, HOTKEY_EVENT};
use crate::shell::{
    resolve_toggle_from_window, AncestorRoot, ForegroundRaw, Minimized, SelfHwnd, ToggleAction, Visible,
};

/// 配置文件写锁：所有 load→modify→save 形态的命令先拿它再动文件。
/// 没有它，两个并发写命令（如设置页同时改阈值与热键）会交错成
/// 「都基于旧文件各改各的、后写者静默抹掉先写者」的丢更新竞态。
static CONFIG_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// 热键**注册表**写锁。注册表与配置文件是两份独立资源，各要各的锁：
/// `set_hotkeys` / `suspend_hotkeys` / `resume_hotkeys` 三个命令改的是同一份注册表
/// （`apply_bindings` = `unregister_all` + 逐条注册），而后两个此前全程在锁外。
///
/// 实测形态：点一次「保存快捷键」这个动作本身就会先 blur 录入框发出 `resume_hotkeys`、
/// 再发出 `set_hotkeys`，前端那两条 promise 互不等待。交错时 `resume` 读到旧配置，
/// `set_hotkeys` 写完文件并注册好新表之后，`resume` 的 `unregister_all` 才落下——
/// 抹掉新表、装回旧表。最终：文件里是新表、页面显示全绿、系统里跑的是旧表。
static HOTKEY_REGISTRY_LOCK: Mutex<()> = Mutex::new(());

/// 持有注册表锁的凭证。碰注册表的函数一律要它的引用，**漏拿锁就编译不过**——
/// 这把锁要防的恰恰是「每个调用点自己记得拿」这种靠约定的写法。
pub struct RegistryGuard<'a>(#[allow(dead_code)] std::sync::MutexGuard<'a, ()>);

pub fn lock_registry() -> RegistryGuard<'static> {
    RegistryGuard(HOTKEY_REGISTRY_LOCK.lock().expect("hotkey registry lock poisoned"))
}

pub struct HotkeyState(pub Mutex<HotkeyDispatcher>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutostartState {
    pub enabled: bool,
    pub user_disabled: bool,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 当前前台窗口的 **(原始句柄, 归一到顶层后的句柄)**。两个都往上送，判定全在
/// `shell::resolve_toggle_from_window` 里做——归一（`GA_ROOT`）这一步留在本文件时
/// 没有任何测试锁得住它：删掉 `GetAncestor` 全套 Rust 单测照绿，而那正是 db28d8b5
/// 修的那个真机 bug 的成因（前台常常是我们自己的 WebView2 子窗口，不归一就比不上）。
///
/// **在取值这一处就套上 newtype**（不在调用处现包）：两个都是 `isize`，返回裸元组时
/// 下游把它们对调照样编译、47 条单测照绿，效果正是「拿未归一的原始句柄去比」——
/// 上面那个 bug 原样复活。套上之后对调是 `error[E0308]`。
#[cfg(windows)]
fn foreground_handles() -> (ForegroundRaw, AncestorRoot) {
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, GA_ROOT};
    // SAFETY: 两个调用都只读窗口管理器状态、不解引用返回的句柄，NULL 输入也有定义
    // （GetAncestor 原样返回 NULL），因此无前置条件可违反。
    unsafe {
        let foreground = GetForegroundWindow();
        (
            ForegroundRaw(foreground.0 as isize),
            AncestorRoot(GetAncestor(foreground, GA_ROOT).0 as isize),
        )
    }
}

/// 非 Windows 平台没有这条事实来源，恒 (0, 0) 让判定退回只看 `is_focused()`——
/// 被修的误报是 Windows/WebView2 特有的。
#[cfg(not(windows))]
fn foreground_handles() -> (ForegroundRaw, AncestorRoot) {
    (ForegroundRaw(0), AncestorRoot(0))
}

fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    #[cfg(windows)]
    let self_hwnd = SelfHwnd(window.hwnd().map(|h| h.0 as isize).unwrap_or(0));
    #[cfg(not(windows))]
    let self_hwnd = SelfHwnd(0);
    let (foreground_raw, ancestor_root) = foreground_handles();
    // 六个值全都先各自绑名带类型再往下传（而不是在调用处现包）：这样把它们的**顺序**写反
    // 是编译错误，正是 newtype 要拦的那类错——纯函数真值表锁得再满也管不到参数落位。
    // 在调用处现包挡不住把两个取值塞进对方的构造器，等于没套。
    let visible = Visible(window.is_visible().unwrap_or(false));
    let minimized = Minimized(window.is_minimized().unwrap_or(false));
    match resolve_toggle_from_window(
        visible,
        minimized,
        window.is_focused().unwrap_or(false),
        foreground_raw,
        ancestor_root,
        self_hwnd,
    ) {
        ToggleAction::Hide => {
            let _ = window.hide();
        }
        ToggleAction::Show => show_main_window(app),
    }
}

fn handle_hotkey(app: &AppHandle, action: &HotkeyAction) {
    match action {
        HotkeyAction::ToggleMain => toggle_main_window(app),
        HotkeyAction::Punch => {
            let payload = HotkeyEventPayload {
                action: action_id(action).to_owned(),
                pressed_at_ms: now_ms(),
            };
            let state: State<HotkeyState> = app.state();
            let deliver = state.0.lock().expect("hotkey dispatcher poisoned").accept(payload);
            if let Some(payload) = deliver {
                let _ = app.emit(HOTKEY_EVENT, payload);
            }
        }
    }
}

/// 注销全部热键。与 `apply_bindings` 一样要注册表锁——它单独出现在 `suspend_hotkeys` 里。
pub fn unregister_all_bindings(app: &AppHandle, _registry: &RegistryGuard<'_>) {
    let _ = app.global_shortcut().unregister_all();
}

/// 全量重注册：先注销全部，再逐条注册。单条失败（被占用/格式非法）不影响其余条目。
/// `_registry` 只为把「必须先拿注册表锁」变成编译期约束（见 `HOTKEY_REGISTRY_LOCK`）。
pub fn apply_bindings(
    app: &AppHandle,
    bindings: &[HotkeyBinding],
    _registry: &RegistryGuard<'_>,
) -> Vec<RegistrationOutcome> {
    let _ = app.global_shortcut().unregister_all();
    bindings
        .iter()
        .map(|binding| {
            let action = binding.action.clone();
            let result = app.global_shortcut().on_shortcut(binding.shortcut.as_str(), move |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    handle_hotkey(app, &action);
                }
            });
            RegistrationOutcome {
                shortcut: binding.shortcut.clone(),
                action: action_id(&binding.action).to_owned(),
                ok: result.is_ok(),
                error: result.err().map(|e| e.to_string()),
            }
        })
        .collect()
}

/// 读配置失败照原样往上抛，**不拿默认值糊弄**：默认阈值 4 小时可能比用户设的宽得多，
/// 静默顶上去就等于替他把「超过 1 小时要先问」放宽成 4 小时、闷头落库。
#[tauri::command]
pub fn get_desktop_config(app: AppHandle) -> Result<DesktopConfig, String> {
    config::load_config(&app)
}

/// 三个写命令都是 load→改→**全量覆盖**写回：`load_config` 一旦读失败就必须在这里止步，
/// 绝不能拿伪造的默认值（`hotkeys: []`、`autostartDisabled: false`）覆盖真文件。
#[tauri::command]
pub fn set_hotkeys(app: AppHandle, bindings: Vec<HotkeyBinding>) -> Result<Vec<RegistrationOutcome>, String> {
    let _guard = CONFIG_WRITE_LOCK.lock().expect("config write lock poisoned");
    let mut cfg = config::load_config(&app)?;
    cfg.hotkeys = bindings;
    config::save_config(&app, &cfg)?;
    let registry = lock_registry();
    Ok(apply_bindings(&app, &cfg.hotkeys, &registry))
}

#[tauri::command]
pub fn set_punch_confirm_hours(app: AppHandle, hours: f64) -> Result<(), String> {
    if !hours.is_finite() || hours <= 0.0 {
        return Err("阈值必须是大于 0 的小时数".to_owned());
    }
    let _guard = CONFIG_WRITE_LOCK.lock().expect("config write lock poisoned");
    let mut cfg = config::load_config(&app)?;
    cfg.punch_confirm_hours = hours;
    config::save_config(&app, &cfg)
}

#[tauri::command]
pub fn get_autostart_state(app: AppHandle) -> Result<AutostartState, String> {
    Ok(AutostartState {
        enabled: app.autolaunch().is_enabled().unwrap_or(false),
        user_disabled: config::load_config(&app)?.autostart_disabled,
    })
}

/// 系统动作（enable/disable）成功而意图落盘失败时，是「系统已变、记录没跟上」的
/// 矛盾态——错误信息把两半都讲清楚，设置页原样展示即可让用户知道现状。
#[tauri::command]
pub fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let _guard = CONFIG_WRITE_LOCK.lock().expect("config write lock poisoned");
    // 先读、读不到就走人：这一步在 enable()/disable() **之前**，读失败时系统状态一个字没改。
    let mut cfg = config::load_config(&app)?;
    if enabled {
        app.autolaunch().enable().map_err(|e| e.to_string())?;
        cfg.autostart_disabled = false;
        config::save_config(&app, &cfg).map_err(|e| format!("自启已开启，但关闭意图记录失败：{e}"))?;
        // 与批 1 的路径标记文件保持同步，换 exe 自愈逻辑照旧。
        if let (Ok(dir), Ok(exe)) = (app.path().app_config_dir(), std::env::current_exe()) {
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(dir.join("autostart-initialized"), exe.to_string_lossy().as_bytes());
        }
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())?;
        cfg.autostart_disabled = true;
        config::save_config(&app, &cfg).map_err(|e| format!("自启已关闭，但意图记录失败：{e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn suspend_hotkeys(app: AppHandle) {
    let registry = lock_registry();
    unregister_all_bindings(&app, &registry);
}

/// 读失败时**一根手指都不碰注册表**：`apply_bindings(&[])` 会先 `unregister_all` 再一条不注册，
/// 一次读不到文件就等于把当前活着的全部热键静默抹掉。
///
/// **先拿注册表锁、再读配置**，这两句的顺序不能倒。互斥锁只保证两条命令不交错、**不保证顺序**：
/// 在锁外读配置时，`resume` 可以读到 `set_hotkeys` 落盘之前的旧表，然后一路排队等锁；等它拿到
/// 锁，`set_hotkeys` 已经写完文件、装好新表并全部释放——`resume` 这才按旧表 `unregister_all`
/// 加重注册，抹掉新表装回旧表。终态正是这把锁本来要防的那一个：文件里是新表、页面显示全绿、
/// 系统里跑的是旧表。锁内读不会死锁：`load_config` 只读文件、不碰 `CONFIG_WRITE_LOCK`，两把锁无环。
#[tauri::command]
pub fn resume_hotkeys(app: AppHandle) -> Result<Vec<RegistrationOutcome>, String> {
    let registry = lock_registry();
    let cfg = config::load_config(&app)?;
    Ok(apply_bindings(&app, &cfg.hotkeys, &registry))
}

#[tauri::command]
pub fn desktop_ready(app: AppHandle, state: State<HotkeyState>) {
    let drained = state.0.lock().expect("hotkey dispatcher poisoned").mark_ready();
    for payload in drained {
        let _ = app.emit(HOTKEY_EVENT, payload);
    }
}

#[tauri::command]
pub fn notify_user(app: AppHandle, title: String, body: String) {
    let _ = app.notification().builder().title(title).body(body).show();
}

#[tauri::command]
pub fn show_main(app: AppHandle) {
    show_main_window(&app);
}
