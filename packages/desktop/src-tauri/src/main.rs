// Windows release 构建下不要弹控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod shell;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};

use shell::{
    resolve_autostart_action, resolve_close_behavior, resolve_tray_action, should_show_on_startup, AutostartAction,
    CloseBehavior, TrayAction,
};

/// 托盘「退出」置上这个标记后再关窗，让 CloseRequested 放行。
static QUITTING: AtomicBool = AtomicBool::new(false);

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
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
                    TrayAction::ShowMain => show_main_window(app),
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
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // 开机自启：标记文件里记的是「上次注册时的 exe 路径」，不是一个布尔。
            // 判定见 shell::resolve_autostart_action——它同时保证「默认开」「换路径能自愈」
            // 和「用户关掉后不回弹」三条。
            let marker = app.path().app_config_dir()?.join("autostart-initialized");
            let recorded = std::fs::read_to_string(&marker).ok().map(|s| s.trim().to_owned());
            let current_exe = std::env::current_exe()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let enabled = app.autolaunch().is_enabled().unwrap_or(false);
            match resolve_autostart_action(recorded.as_deref(), &current_exe, enabled) {
                AutostartAction::Enable => {
                    let _ = app.autolaunch().enable();
                    if let Some(dir) = marker.parent() {
                        let _ = std::fs::create_dir_all(dir);
                    }
                    let _ = std::fs::write(&marker, &current_exe);
                }
                AutostartAction::LeaveAlone => {}
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
