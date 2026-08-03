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
use crate::hotkeys::{HotkeyDispatcher, HotkeyEventPayload, RegistrationOutcome};
use crate::shell::{resolve_is_foreground, resolve_toggle_action, ToggleAction};

/// 配置文件写锁：所有 load→modify→save 形态的命令先拿它再动文件。
/// 没有它，两个并发写命令（如设置页同时改阈值与热键）会交错成
/// 「都基于旧文件各改各的、后写者静默抹掉先写者」的丢更新竞态。
static CONFIG_WRITE_LOCK: Mutex<()> = Mutex::new(());

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

/// 当前前台窗口归一到顶层后的句柄；没有前台窗口时为 0。
/// 归一（`GA_ROOT`）这步是关键：前台常常是我们自己的 WebView2 子窗口，不归一就比不上。
#[cfg(windows)]
fn foreground_root_hwnd() -> isize {
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, GA_ROOT};
    // SAFETY: 两个调用都只读窗口管理器状态、不解引用返回的句柄，NULL 输入也有定义
    // （GetAncestor 原样返回 NULL），因此无前置条件可违反。
    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.0.is_null() {
            return 0;
        }
        GetAncestor(foreground, GA_ROOT).0 as isize
    }
}

/// 非 Windows 平台没有这条事实来源，恒 0 让判定退回只看 `is_focused()`——
/// 被修的误报是 Windows/WebView2 特有的。
#[cfg(not(windows))]
fn foreground_root_hwnd() -> isize {
    0
}

fn toggle_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    #[cfg(windows)]
    let self_hwnd = window.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    #[cfg(not(windows))]
    let self_hwnd = 0isize;
    let focused = resolve_is_foreground(
        window.is_focused().unwrap_or(false),
        foreground_root_hwnd(),
        self_hwnd,
    );
    match resolve_toggle_action(visible, minimized, focused) {
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
                let _ = app.emit("desktop-hotkey", payload);
            }
        }
    }
}

/// 全量重注册：先注销全部，再逐条注册。单条失败（被占用/格式非法）不影响其余条目。
pub fn apply_bindings(app: &AppHandle, bindings: &[HotkeyBinding]) -> Vec<RegistrationOutcome> {
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

#[tauri::command]
pub fn get_desktop_config(app: AppHandle) -> DesktopConfig {
    config::load_config(&app)
}

#[tauri::command]
pub fn set_hotkeys(app: AppHandle, bindings: Vec<HotkeyBinding>) -> Result<Vec<RegistrationOutcome>, String> {
    let _guard = CONFIG_WRITE_LOCK.lock().expect("config write lock poisoned");
    let mut cfg = config::load_config(&app);
    cfg.hotkeys = bindings;
    config::save_config(&app, &cfg)?;
    Ok(apply_bindings(&app, &cfg.hotkeys))
}

#[tauri::command]
pub fn set_punch_confirm_hours(app: AppHandle, hours: f64) -> Result<(), String> {
    if !hours.is_finite() || hours <= 0.0 {
        return Err("阈值必须是大于 0 的小时数".to_owned());
    }
    let _guard = CONFIG_WRITE_LOCK.lock().expect("config write lock poisoned");
    let mut cfg = config::load_config(&app);
    cfg.punch_confirm_hours = hours;
    config::save_config(&app, &cfg)
}

#[tauri::command]
pub fn get_autostart_state(app: AppHandle) -> AutostartState {
    AutostartState {
        enabled: app.autolaunch().is_enabled().unwrap_or(false),
        user_disabled: config::load_config(&app).autostart_disabled,
    }
}

/// 系统动作（enable/disable）成功而意图落盘失败时，是「系统已变、记录没跟上」的
/// 矛盾态——错误信息把两半都讲清楚，设置页原样展示即可让用户知道现状。
#[tauri::command]
pub fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let _guard = CONFIG_WRITE_LOCK.lock().expect("config write lock poisoned");
    let mut cfg = config::load_config(&app);
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
    let _ = app.global_shortcut().unregister_all();
}

#[tauri::command]
pub fn resume_hotkeys(app: AppHandle) -> Vec<RegistrationOutcome> {
    let cfg = config::load_config(&app);
    apply_bindings(&app, &cfg.hotkeys)
}

#[tauri::command]
pub fn desktop_ready(app: AppHandle, state: State<HotkeyState>) {
    let drained = state.0.lock().expect("hotkey dispatcher poisoned").mark_ready();
    for payload in drained {
        let _ = app.emit("desktop-hotkey", payload);
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
