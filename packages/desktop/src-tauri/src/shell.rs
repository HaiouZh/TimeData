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
    /// 首次运行：注册自启并记下当前可执行文件路径。
    EnableAndRecord,
    /// 自启还开着但可执行文件搬家了（dev→release→安装版、重装到别处）：把注册更新到新路径。
    RefreshPath,
    /// 用户手动关掉了，或路径没变——都不要碰。
    LeaveAlone,
}

/// 决定启动时怎么处理开机自启。
///
/// 标记文件里存的是「上次注册时的可执行文件路径」，不是一个布尔。
/// 只记「做没做过」会留下一个无声的坑：构建产物先注册过，装了正式版后启动项
/// 仍指向构建目录，那个目录一清理，开机自启就失效且不报错（2026-08-03 实测踩到）。
///
/// 但路径变化**不能**成为把用户关掉的自启重新打开的理由，故 `currently_enabled`
/// 为 false 时一律 LeaveAlone。
pub fn resolve_autostart_action(
    recorded_path: Option<&str>,
    current_path: &str,
    currently_enabled: bool,
) -> AutostartAction {
    match recorded_path {
        None => AutostartAction::EnableAndRecord,
        Some(recorded) if currently_enabled && recorded != current_path => AutostartAction::RefreshPath,
        Some(_) => AutostartAction::LeaveAlone,
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
    fn 首次运行注册自启并记下路径() {
        assert_eq!(
            resolve_autostart_action(None, "C:/app/TimeData.exe", false),
            AutostartAction::EnableAndRecord
        );
    }

    #[test]
    fn 路径没变就什么都不做() {
        assert_eq!(
            resolve_autostart_action(Some("C:/app/TimeData.exe"), "C:/app/TimeData.exe", true),
            AutostartAction::LeaveAlone
        );
    }

    #[test]
    fn 换了安装路径且自启还开着时更新注册() {
        // 实测踩过：dev/release 构建先注册过，装了正式版后启动项仍指向构建产物，
        // 构建目录一清理，开机自启就无声失效。
        assert_eq!(
            resolve_autostart_action(Some("D:/build/timedata-desktop.exe"), "C:/app/TimeData.exe", true),
            AutostartAction::RefreshPath
        );
    }

    #[test]
    fn 用户关掉自启后换路径也不许回弹() {
        // 这条守「关得掉」：不能借「路径变了」把用户明确关掉的自启偷偷开回来。
        assert_eq!(
            resolve_autostart_action(Some("D:/build/timedata-desktop.exe"), "C:/app/TimeData.exe", false),
            AutostartAction::LeaveAlone
        );
    }

    #[test]
    fn 旧版只写1的标记会被当成路径不符而自愈() {
        // 早期实现往标记里写的是 "1"。它与任何真实路径都不相等，
        // 因此自启还开着时会走 RefreshPath 把路径纠正过来，不需要迁移代码。
        assert_eq!(
            resolve_autostart_action(Some("1"), "C:/app/TimeData.exe", true),
            AutostartAction::RefreshPath
        );
    }
}
