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

/// 「默认开自启」只做一次，靠一个标记文件记住做过了。
/// 不能改成按当前是否已启用来判断——那样用户手动关掉后，下次启动会被重新开上，
/// 表现为「自启关不掉」。
pub fn should_apply_default_autostart(marker_exists: bool) -> bool {
    !marker_exists
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
    fn 首次启动才默认开自启() {
        assert!(should_apply_default_autostart(false));
    }

    #[test]
    fn 标记已在就不再碰自启开关() {
        // 这条守的是「用户手动关掉后不许回弹」：若改回按 is_enabled() 判断，
        // 关掉的下一次启动就会重新开上，用户永远关不掉。
        assert!(!should_apply_default_autostart(true));
    }
}
