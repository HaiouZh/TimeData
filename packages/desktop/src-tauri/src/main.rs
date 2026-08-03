// Windows release 构建下不要弹控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod hotkeys;
mod shell;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};
use tauri_plugin_notification::NotificationExt;

use commands::HotkeyState;
use shell::{
    resolve_autostart_action, resolve_close_behavior, resolve_tray_action, should_show_on_startup, AutostartAction,
    CloseBehavior, Enabled, TrayAction, UserDisabled,
};

/// 托盘「退出」置上这个标记后再关窗，让 CloseRequested 放行。
static QUITTING: AtomicBool = AtomicBool::new(false);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(HotkeyState(Mutex::new(hotkeys::HotkeyDispatcher::new())))
        .invoke_handler(tauri::generate_handler![
            commands::get_desktop_config,
            commands::set_hotkeys,
            commands::set_punch_confirm_hours,
            commands::get_autostart_state,
            commands::set_autostart_enabled,
            commands::suspend_hotkeys,
            commands::resume_hotkeys,
            commands::desktop_ready,
            commands::notify_user,
            commands::show_main,
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "打开 TimeData", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("TimeData")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match resolve_tray_action(event.id().as_ref()) {
                    TrayAction::ShowMain => commands::show_main_window(app),
                    TrayAction::Quit => {
                        QUITTING.store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                    TrayAction::Noop => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // 左键单击托盘图标 = 打开主窗口，和菜单里的「打开」等价。
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        commands::show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // 读配置失败 ≠ 文件不存在（见 config::read_config_at）：文件可能好端端的，只是被
            // 杀软 / OneDrive / 备份工具短暂独占。此时**下面这一整段都不做**——拿全默认值往下走
            // 会替用户做两件他没要求的事：把设置页里关掉的自启重新打开（autostart_disabled
            // 假装成 false），以及按空表注册热键（整个 session 一个热键都没有）。
            // 什么都不做的代价只是「本次启动热键没起来」，重启即恢复，比那两件都轻。
            let desktop_config = match config::load_config(app.handle()) {
                Ok(cfg) => Some(cfg),
                Err(message) => {
                    // 启动期还没有窗口可回显，只能走系统通知；发不出去也不阻塞启动。
                    let _ = app
                        .notification()
                        .builder()
                        .title("TimeData")
                        .body(format!("{message}\n本次启动不改动开机自启、也不注册快捷键。"))
                        .show();
                    None
                }
            };

            if let Some(desktop_config) = &desktop_config {
                // 开机自启：标记文件里记的是「上次注册时的 exe 路径」，不是一个布尔。
                // 判定见 shell::resolve_autostart_action——它同时保证「默认开」「换路径能自愈」
                // 和「用户关掉后不回弹」三条。关闭意图来自 desktop-config.json（设置页写入）。
                let marker = app.path().app_config_dir()?.join("autostart-initialized");
                let recorded = std::fs::read_to_string(&marker).ok().map(|s| s.trim().to_owned());
                let current_exe = std::env::current_exe()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let enabled = app.autolaunch().is_enabled().unwrap_or(false);
                match resolve_autostart_action(
                    recorded.as_deref(),
                    &current_exe,
                    Enabled(enabled),
                    UserDisabled(desktop_config.autostart_disabled),
                ) {
                    AutostartAction::Enable => {
                        let _ = app.autolaunch().enable();
                        if let Some(dir) = marker.parent() {
                            let _ = std::fs::create_dir_all(dir);
                        }
                        let _ = std::fs::write(&marker, &current_exe);
                    }
                    AutostartAction::LeaveAlone => {}
                }

                // 启动即注册热键（不等 WebView，spec §五.1）。失败无处回显（窗口可能还没
                // 起来），设置页打开时 resume_hotkeys 会重报注册结果。
                let registry = commands::lock_registry();
                let _ = commands::apply_bindings(app.handle(), &desktop_config.hotkeys, &registry);
            }

            // 被开机自启拉起时不弹窗口，直接躲托盘。
            let args: Vec<String> = std::env::args().collect();
            if !should_show_on_startup(&args) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                match resolve_close_behavior(QUITTING.load(Ordering::SeqCst)) {
                    CloseBehavior::HideToTray => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    CloseBehavior::ReallyClose => {}
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running TimeData desktop shell");
}
