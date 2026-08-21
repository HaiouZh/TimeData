// Windows release 构建下不要弹控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod hotkeys;
mod shell;
mod updater;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};
use tauri_plugin_notification::NotificationExt;

use commands::HotkeyState;
use updater::UpdaterState;
use shell::{
    resolve_autostart_action, resolve_close_behavior, resolve_tray_action, should_show_on_startup, AutostartAction,
    CloseBehavior, Enabled, TrayAction, UserDisabled,
};

/// 托盘「退出」置上这个标记后再关窗，让 CloseRequested 放行。
static QUITTING: AtomicBool = AtomicBool::new(false);

/// 主窗口最近一次正常态几何的内存缓存。`None` 表示还没播种（理论上不会发生：setup 里就播种）。
struct WindowStateCache(Mutex<Option<shell::NormalGeometry>>);

/// 把缓存的正常态几何 + 此刻的最大化标志落盘。走 `update_config`：读失败当场放弃本次
/// 保存（绝不拿伪造的默认配置覆盖真文件，spec 拍板⑧），Err 静默吞掉——下次保存点再试，
/// 不值得为窗口大小打扰用户。
fn persist_window_state(app: &AppHandle) {
    let Some(window) = app.get_webview_window(shell::MAIN_WINDOW) else { return };
    let geometry = *window
        .state::<WindowStateCache>()
        .0
        .lock()
        .expect("window state cache poisoned");
    let Some(geometry) = geometry else { return };
    let maximized = window.is_maximized().unwrap_or(false);
    let _ = config::update_config(app, |cfg| {
        cfg.window_state = Some(config::WindowState {
            width: geometry.width,
            height: geometry.height,
            x: geometry.x,
            y: geometry.y,
            maximized,
        });
    });
}

/// 启动时把主窗口摆回上次的几何。位置先过显示器相交判定：拔掉副屏后存的位置出界，
/// 回退居中而不是把窗口丢到不可达的地方。maximize 放最后——先摆好还原尺寸再最大化，
/// 用户取消最大化时回到的是记忆尺寸而非 conf 默认。
///
/// **顺序红线（spec 拍板⑦）**：调用点必须在 `--hidden` 隐藏逻辑之前——`maximize()` 会把
/// 隐藏窗口顶出来（Windows `ShowWindow(SW_MAXIMIZE)` 对隐藏窗口即显示），靠后面已有的
/// hide 步骤兜底藏回去。
fn restore_window_state(app: &AppHandle, saved: config::WindowState) {
    let Some(window) = app.get_webview_window(shell::MAIN_WINDOW) else { return };
    let width = (saved.width.round() as i64).max(1) as u32;
    let height = (saved.height.round() as i64).max(1) as u32;
    let _ = window.set_size(tauri::PhysicalSize::new(width, height));
    let monitors: Vec<shell::MonitorRect> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            (position.x as i64, position.y as i64, size.width as i64, size.height as i64)
        })
        .collect();
    if shell::position_on_any_monitor(
        saved.x as i64,
        saved.y as i64,
        saved.width as i64,
        saved.height as i64,
        &monitors,
    ) {
        let _ = window.set_position(tauri::PhysicalPosition::new(saved.x, saved.y));
    } else {
        let _ = window.center();
    }
    if saved.maximized {
        let _ = window.maximize();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(HotkeyState(Mutex::new(hotkeys::HotkeyDispatcher::new())))
        .manage(UpdaterState::default())
        .manage(WindowStateCache(Mutex::new(None)))
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
            commands::hide_capture_window,
            commands::updater_status,
            commands::updater_check_now,
            commands::updater_install,
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
                let marker = app.path().app_config_dir()?.join(shell::AUTOSTART_MARKER);
                let recorded = std::fs::read_to_string(&marker).ok().map(|s| s.trim().to_owned());
                let current_exe = std::env::current_exe()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default();
                // 先套 newtype 再传（不在调用处现包）：这两个 bool 相邻同类型，写反
                // 会复活「换安装路径后自启静默失效」，而纯函数真值表锁不到参数落位。
                let enabled = Enabled(app.autolaunch().is_enabled().unwrap_or(false));
                let user_disabled = UserDisabled(desktop_config.autostart_disabled);
                match resolve_autostart_action(recorded.as_deref(), &current_exe, enabled, user_disabled) {
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
                //
                // 这里的配置是上面读的、锁在这一句才拿——`resume_hotkeys` 里被判为竞态的正是这个
                // 「先读后锁」形态，在这里却安全：setup 跑在事件循环启动**之前**，而三个写注册表的
                // 命令全都要事件循环派发，此刻一条都不可能在跑。别照搬这个顺序到命令里。
                let registry = commands::lock_registry();
                let _ = commands::apply_bindings(app.handle(), &desktop_config.hotkeys, &registry);
            }

            // 窗口状态恢复（spec §4）。**必须排在下面 --hidden 隐藏之前**：maximize() 会把
            // 隐藏窗口顶出来，靠后面已有的 hide 步骤兜底藏回去（拍板⑦顺序红线）。
            if let Some(saved) = desktop_config.as_ref().and_then(|cfg| cfg.window_state) {
                restore_window_state(app.handle(), saved);
            }

            // 播种几何缓存：有存储值直接用（它必然是某次正常态的快照）；没有则问窗口要实际值。
            // 不从「刚 maximize 完的窗口」现查——那查到的是整屏尺寸。
            let seeded = desktop_config
                .as_ref()
                .and_then(|cfg| cfg.window_state)
                .map(|saved| shell::NormalGeometry { width: saved.width, height: saved.height, x: saved.x, y: saved.y })
                .or_else(|| {
                    let window = app.get_webview_window(shell::MAIN_WINDOW)?;
                    let size = window.inner_size().ok()?;
                    let position = window.outer_position().ok()?;
                    Some(shell::NormalGeometry {
                        width: size.width as f64,
                        height: size.height as f64,
                        x: position.x,
                        y: position.y,
                    })
                });
            *app.state::<WindowStateCache>().0.lock().expect("window state cache poisoned") = seeded;

            // 被开机自启拉起时不弹主窗口，直接躲托盘。浮窗则**任何情况下**都起手隐藏：
            // 它只由 capture 热键唤起，配置里 visible:false 已是这个意思，这里是双保险
            // （改配置漏改一处时不至于让浮窗糊在屏幕正中）。
            let args: Vec<String> = std::env::args().collect();
            if !should_show_on_startup(&args) {
                if let Some(window) = app.get_webview_window(shell::MAIN_WINDOW) {
                    let _ = window.hide();
                }
            }
            if let Some(window) = app.get_webview_window(shell::CAPTURE_WINDOW) {
                let _ = window.hide();
            }

            // 启动后延迟首查，之后每 4 小时一轮。跑在 Tauri 自己的 async runtime 上。
            // 检查与下载全程静默，失败只落 lastError。dev 构建整条不启动。
            if !cfg!(debug_assertions) {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(updater::STARTUP_DELAY_MS)).await;
                    loop {
                        commands::run_update_check(handle.clone(), false).await;
                        tokio::time::sleep(std::time::Duration::from_millis(updater::CHECK_INTERVAL_MS)).await;
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                match resolve_close_behavior(QUITTING.load(Ordering::SeqCst)) {
                    CloseBehavior::HideToTray => {
                        api.prevent_close();
                        // 保存点 1：隐藏到托盘前落盘（此时窗口几何仍是最新鲜的）。
                        persist_window_state(window.app_handle());
                        let _ = window.hide();
                    }
                    CloseBehavior::ReallyClose => {}
                }
            }
            WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                // 只有主窗参与；浮窗固定尺寸不采。
                if window.label() != shell::MAIN_WINDOW {
                    return;
                }
                if shell::resolve_window_capture(
                    window.is_maximized().unwrap_or(false),
                    window.is_minimized().unwrap_or(false),
                ) == shell::WindowCapture::Skip
                {
                    return;
                }
                if let (Ok(size), Ok(position)) = (window.inner_size(), window.outer_position()) {
                    let state = window.state::<WindowStateCache>();
                    let mut cache = state.0.lock().expect("window state cache poisoned");
                    *cache = Some(shell::NormalGeometry {
                        width: size.width as f64,
                        height: size.height as f64,
                        x: position.x,
                        y: position.y,
                    });
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building TimeData desktop shell")
        .run(|app, event| {
            // 保存点 2：真退出（托盘「退出」的 app.exit(0) 走这里）。
            if let RunEvent::ExitRequested { .. } = event {
                persist_window_state(app);
            }
        });
}
