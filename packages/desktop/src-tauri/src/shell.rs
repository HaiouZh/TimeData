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
}
