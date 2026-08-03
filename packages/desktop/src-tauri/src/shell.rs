/// 关窗行为。壳的「常驻」语义全靠这一条：点 X 不退出。
/// 真退出只有一条路——托盘菜单的「退出」先置上 quitting 标记再关窗。
#[derive(Debug, PartialEq, Eq)]
pub enum CloseBehavior {
    HideToTray,
    ReallyClose,
}

pub fn resolve_close_behavior(quitting: bool) -> CloseBehavior {
    if quitting {
        CloseBehavior::ReallyClose
    } else {
        CloseBehavior::HideToTray
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum TrayAction {
    ShowMain,
    Quit,
    Noop,
}

pub fn resolve_tray_action(menu_id: &str) -> TrayAction {
    match menu_id {
        "show" => TrayAction::ShowMain,
        "quit" => TrayAction::Quit,
        _ => TrayAction::Noop,
    }
}

/// 开机自启注册时带 `--hidden`：被系统拉起时直接躲托盘，不打扰开机流程。
/// 手动双击图标不带这个参数，正常显示窗口。
pub fn should_show_on_startup(args: &[String]) -> bool {
    !args.iter().any(|arg| arg == "--hidden")
}

#[derive(Debug, PartialEq, Eq)]
pub enum AutostartAction {
    /// （重新）注册自启到当前可执行文件，并记下这个路径。
    Enable,
    /// 已经注册到当前可执行文件，不动。
    LeaveAlone,
}

/// 决定启动时怎么处理开机自启。策略：**用户主动关过（user_disabled，来自 desktop-config.json）
/// 就一律不碰；否则维持批 1 语义——启动项只要不是"已注册到当前这个 exe"，就重新注册**。
///
/// 两个实测踩到的场景逼出重注册这半边（2026-08-03）：
/// ① 构建产物先注册过，装了正式版后启动项仍指向构建目录，那目录一清理自启就无声失效；
/// ② NSIS 装新版时会先卸载旧版，把启动项一并清掉——升级后自启就没了。
///
/// 场景②与"用户自己在系统设置里关掉"在系统层面**完全无法区分**，批 1 拍板取
/// "升级后自动恢复"：无声失效比偶尔回弹更糟，且升级是常态操作。代价是在系统层面
/// （任务管理器）关掉会被下次启动改回来。user_disabled 就是还这笔账的口子：
/// 在应用设置页里关会写进自己的配置文件，这里读到后任何情形都不再碰启动项。
pub fn resolve_autostart_action(
    recorded_path: Option<&str>,
    current_path: &str,
    currently_enabled: bool,
    user_disabled: bool,
) -> AutostartAction {
    if user_disabled {
        return AutostartAction::LeaveAlone;
    }
    if !currently_enabled {
        return AutostartAction::Enable;
    }
    match recorded_path {
        Some(recorded) if recorded == current_path => AutostartAction::LeaveAlone,
        _ => AutostartAction::Enable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 普通关窗只隐藏不退出() {
        assert_eq!(resolve_close_behavior(false), CloseBehavior::HideToTray);
    }

    #[test]
    fn 走托盘退出时才真的关() {
        assert_eq!(resolve_close_behavior(true), CloseBehavior::ReallyClose);
    }

    #[test]
    fn 托盘菜单项路由到对应动作() {
        assert_eq!(resolve_tray_action("show"), TrayAction::ShowMain);
        assert_eq!(resolve_tray_action("quit"), TrayAction::Quit);
    }

    #[test]
    fn 未知菜单项不做任何事() {
        assert_eq!(resolve_tray_action("whatever"), TrayAction::Noop);
        assert_eq!(resolve_tray_action(""), TrayAction::Noop);
    }

    #[test]
    fn 手动启动时显示窗口() {
        let args = vec!["timedata-desktop.exe".to_string()];
        assert!(should_show_on_startup(&args));
    }

    #[test]
    fn 开机自启带hidden参数时不显示窗口() {
        let args = vec!["timedata-desktop.exe".to_string(), "--hidden".to_string()];
        assert!(!should_show_on_startup(&args));
    }

    #[test]
    fn hidden参数在任意位置都算数() {
        let args = vec![
            "timedata-desktop.exe".to_string(),
            "--hidden".to_string(),
            "--whatever".to_string(),
        ];
        assert!(!should_show_on_startup(&args));
    }

    #[test]
    fn 首次运行注册自启() {
        assert_eq!(
            resolve_autostart_action(None, "C:/app/TimeData.exe", false, false),
            AutostartAction::Enable
        );
    }

    #[test]
    fn 已注册到当前exe就不动() {
        assert_eq!(
            resolve_autostart_action(Some("C:/app/TimeData.exe"), "C:/app/TimeData.exe", true, false),
            AutostartAction::LeaveAlone
        );
    }

    #[test]
    fn 启动项被外部清掉时恢复() {
        // 实测踩过：NSIS 装新版会先卸载旧版，把启动项一并带走，升级后自启静默消失。
        // 记录路径与当前一致、但系统里已经没有启动项——必须恢复。
        assert_eq!(
            resolve_autostart_action(Some("C:/app/TimeData.exe"), "C:/app/TimeData.exe", false, false),
            AutostartAction::Enable
        );
    }

    #[test]
    fn 换了安装路径时重新注册到新路径() {
        // 实测踩过：dev/release 构建先注册过，装了正式版后启动项仍指向构建产物，
        // 那个目录一清理，开机自启就无声失效。
        assert_eq!(
            resolve_autostart_action(Some("D:/build/timedata-desktop.exe"), "C:/app/TimeData.exe", true, false),
            AutostartAction::Enable
        );
    }

    #[test]
    fn 旧版只写1的标记会被当成路径不符而重注册() {
        // 早期实现往标记里写的是 "1"，与任何真实路径都不相等，因此会被重新注册并改写成路径，
        // 不需要单独的迁移代码。
        assert_eq!(
            resolve_autostart_action(Some("1"), "C:/app/TimeData.exe", true, false),
            AutostartAction::Enable
        );
    }

    // ---- 自启欠账（批 2）：用户在设置页关掉后，任何情形都不许回弹 ----

    #[test]
    fn user_disabled_beats_missing_registration() {
        // NSIS 升级清掉了启动项（enabled=false），但用户此前主动关过 → 不恢复。
        assert_eq!(
            resolve_autostart_action(None, r"C:\app\TimeData.exe", false, true),
            AutostartAction::LeaveAlone
        );
    }

    #[test]
    fn user_disabled_beats_path_change() {
        assert_eq!(
            resolve_autostart_action(Some(r"C:\old\TimeData.exe"), r"C:\new\TimeData.exe", true, true),
            AutostartAction::LeaveAlone
        );
    }

    #[test]
    fn user_disabled_leaves_matching_registration_alone() {
        assert_eq!(
            resolve_autostart_action(Some(r"C:\app\TimeData.exe"), r"C:\app\TimeData.exe", true, true),
            AutostartAction::LeaveAlone
        );
    }
}
