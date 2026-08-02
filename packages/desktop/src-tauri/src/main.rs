// Windows release 构建下不要弹控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod shell;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};

use shell::{resolve_close_behavior, resolve_tray_action, CloseBehavior, TrayAction};

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
