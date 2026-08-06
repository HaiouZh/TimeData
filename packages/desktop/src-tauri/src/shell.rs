/// 关窗行为。壳的「常驻」语义全靠这一条：点 X 不退出。
/// 真退出只有一条路——托盘菜单的「退出」先置上 quitting 标记再关窗。
#[derive(Debug, PartialEq, Eq)]
pub enum CloseBehavior {
    HideToTray,
    ReallyClose,
}

use crate::config::HotkeyAction;

/// 窗口 label。两个字面量同时活在 tauri.conf.json、capabilities/default.json 与前端的
/// `?window=capture` 判据里，Rust 侧只准在这里各出现一次。
pub const MAIN_WINDOW: &str = "main";
pub const CAPTURE_WINDOW: &str = "capture";

/// 自启标记文件名。文件内容记的是「上次注册时的 exe 路径」，不是一个布尔——
/// 判定见 `resolve_autostart_action`。
pub const AUTOSTART_MARKER: &str = "autostart-initialized";

/// 动作落到哪个 WebView。`None` = Rust 直办、不投窗口。
///
/// **这张表是「一次 punch 只落一条」的第二道保险**（第一道是前端入口分流）。
/// 改成广播就意味着两个 WebView 各跑一遍 punch，各自在对方写库前读到同一条锚点记录，
/// 写出两条完全重叠的假记录，编译不报错、测试一条不红。
pub fn target_window(action: &HotkeyAction) -> Option<&'static str> {
    match action {
        HotkeyAction::Punch => Some(MAIN_WINDOW),
        HotkeyAction::Capture => Some(CAPTURE_WINDOW),
        HotkeyAction::ToggleMain => None,
        HotkeyAction::Navigate { .. } => Some(MAIN_WINDOW),
    }
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

/// 相邻同类型 bool 的传反是纯函数真值表**锁不住**的一类错：`resolve_toggle_action` 与
/// `resolve_autostart_action` 的真值表锁得很满（合并判断、`&&`/`||` 反转、守卫换序都会红），
/// 但装配层把两个参数写颠倒照样编译、整套用例照绿——分别复活「toggleMain 永远收不起来」
/// 与「换安装路径后自启静默失效」两个已修 bug。套成 newtype 后传反是编译错误。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Visible(pub bool);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Minimized(pub bool);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Enabled(pub bool);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UserDisabled(pub bool);

/// 三个窗口句柄同理，而且更险：它们是**同类型同量纲**的三个 `isize`，写反不但编译得过、
/// 真值表也一条都不会红。`foreground_raw` 与 `ancestor_root` 对调的效果恰好是「拿未归一的
/// 原始句柄去比」——db28d8b5 修的那个真机 bug 的成因原样复活（前台是自己的 WebView2
/// 子窗口时判不在前台 → 每次都 Show → 窗口再也收不起来）。
///
/// 取值处就套上（`foreground_handles` 直接返回这对 newtype、`self_hwnd` 绑名时就包好），
/// **不在调用处现包**：调用处现包挡不住把两个取值塞进对方的构造器，等于没套。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ForegroundRaw(pub isize);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AncestorRoot(pub isize);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SelfHwnd(pub isize);

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
    currently_enabled: Enabled,
    user_disabled: UserDisabled,
) -> AutostartAction {
    if user_disabled.0 {
        return AutostartAction::LeaveAlone;
    }
    if !currently_enabled.0 {
        return AutostartAction::Enable;
    }
    match recorded_path {
        Some(recorded) if recorded == current_path => AutostartAction::LeaveAlone,
        _ => AutostartAction::Enable,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum ToggleAction {
    Hide,
    Show,
}

/// 「本窗口是否在前台」的合成判定，喂给 `resolve_toggle_action` 的 `focused` 位。
///
/// 单靠 tao 的 `is_focused()` 不够：实测（2026-08-03）WebView2 子窗口吃走键盘焦点后，
/// 它会在窗口明明处于最前时稳定报 false，于是 toggleMain 每次都走 Show 分支、**再也收不起来**。
/// 因此补一路 Win32 事实来源——前台窗口归一到顶层（`GetAncestor(GA_ROOT)`）后与本窗口 HWND 比，
/// 前台是我们自己的 WebView2 子窗口时也算数。
///
/// 两路取**或**，方向是「宁可收起」：误判 Hide 的代价是用户多按一次热键（第二次窗口已隐藏、
/// 必然 Show，自愈）；误判 Show 的代价是窗口永远收不起来、按多少次都没用——正是本次修的 bug。
/// 顺带兜住 `hwnd()` 取不到的情形（`self_hwnd` 为 0）：行为退回只看 `is_focused()` 的原样，
/// 而不是彻底不隐藏。
///
/// 句柄 0 = 没有窗口（无前台窗口时 `GetForegroundWindow` 返回 NULL），**不参与相等比较**，
/// 否则「两边都拿不到」会被当成「前台就是我」，凭空造出一次误 Hide。
pub fn resolve_is_foreground(is_focused: bool, foreground_root: AncestorRoot, self_hwnd: SelfHwnd) -> bool {
    let foreground_is_ours = self_hwnd.0 != 0 && foreground_root.0 == self_hwnd.0;
    is_focused || foreground_is_ours
}

/// toggleMain 语义：前台可见（未最小化且有焦点）才收起；其余一律带到前面。
/// "可见但被别的窗口盖住"判 Show——用户按热键是想见到它。
pub fn resolve_toggle_action(visible: Visible, minimized: Minimized, focused: bool) -> ToggleAction {
    if visible.0 && !minimized.0 && focused {
        ToggleAction::Hide
    } else {
        ToggleAction::Show
    }
}

/// 从「窗口的原始事实」一步合成 toggle 动作：装配层（`commands.rs`）只负责取这六个值，
/// 一句判断都不做。
///
/// 这么切是因为**「前台句柄必须先归一到顶层」这个自由度原先完全没锁**——它留在装配层时，
/// 把 `GetAncestor(GA_ROOT)` 整句删掉，全套 Rust 单测照绿，而那正是 db28d8b5 修的真机
/// bug 的成因（WebView2 子窗口在前台时，原始句柄 ≠ 主窗口句柄 → 判不在前台 → 每次都 Show
/// → 窗口再也收不起来）。
///
/// `foreground_raw` 只回答「有没有前台窗口」（NULL/0 → 谁都不是，不参与相等比较）；
/// 真正拿去比的必须是归一后的 `ancestor_root`。这两个各有 newtype（见上），把它们对调
/// 是**编译错误**——它们同类型同量纲，靠真值表或人眼都拦不住。
pub fn resolve_toggle_from_window(
    visible: Visible,
    minimized: Minimized,
    is_focused: bool,
    foreground_raw: ForegroundRaw,
    ancestor_root: AncestorRoot,
    self_hwnd: SelfHwnd,
) -> ToggleAction {
    let foreground_root = if foreground_raw.0 == 0 { AncestorRoot(0) } else { ancestor_root };
    resolve_toggle_action(visible, minimized, resolve_is_foreground(is_focused, foreground_root, self_hwnd))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn punch_goes_to_main_capture_goes_to_capture_toggle_goes_nowhere() {
        use crate::config::HotkeyAction;
        assert_eq!(target_window(&HotkeyAction::Punch), Some(MAIN_WINDOW));
        assert_eq!(target_window(&HotkeyAction::Capture), Some(CAPTURE_WINDOW));
        // toggleMain 由 Rust 直办，不投给任何 WebView——投了就是白白唤醒一个不处理它的桥。
        assert_eq!(target_window(&HotkeyAction::ToggleMain), None);
        // navigate 与 punch 同投主窗口：它要显示的就是主窗口，没有第二个候选。
        assert_eq!(
            target_window(&HotkeyAction::Navigate { target: "/todo".into() }),
            Some(MAIN_WINDOW)
        );
    }

    #[test]
    fn window_labels_match_tauri_conf() {
        // **这条测试真去读那两个 JSON**。写成 `assert_eq!(MAIN_WINDOW, "main")` 是拿常量跟
        // 自己同文件里的字面量比——改 label 时把两边一起改就照绿，而 `get_webview_window`
        // 会静默返回 None，热键唤起、toggleMain、show_main 一起失效，没有任何闸会红。
        let conf: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string("tauri.conf.json").expect("读 tauri.conf.json"))
                .expect("解析 tauri.conf.json");
        let declared: Vec<String> = conf["app"]["windows"]
            .as_array()
            .expect("app.windows 必须是数组")
            .iter()
            .map(|w| w["label"].as_str().expect("每个窗口都要有 label").to_owned())
            .collect();
        for label in [MAIN_WINDOW, CAPTURE_WINDOW] {
            assert!(
                declared.iter().any(|d| d == label),
                "tauri.conf.json 的 app.windows 里没有 label={label} 的窗口，实际声明的是 {declared:?}"
            );
        }

        // capabilities 漏一个 label 更隐蔽：那个窗口建得出来、看得见，但它发起的
        // listen / invoke 全被权限层静默拒掉——前端只表现为「热键唤起后什么都没发生」。
        let caps: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string("capabilities/default.json").expect("读 capabilities/default.json"),
        )
        .expect("解析 capabilities/default.json");
        let authorized: Vec<String> = caps["windows"]
            .as_array()
            .expect("capabilities.windows 必须是数组")
            .iter()
            .map(|w| w.as_str().expect("label 必须是字符串").to_owned())
            .collect();
        for label in [MAIN_WINDOW, CAPTURE_WINDOW] {
            assert!(
                authorized.iter().any(|a| a == label),
                "capabilities/default.json 没给 {label} 授权，实际授权的是 {authorized:?}"
            );
        }
    }

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
            resolve_autostart_action(None, "C:/app/TimeData.exe", Enabled(false), UserDisabled(false)),
            AutostartAction::Enable
        );
    }

    #[test]
    fn 已注册到当前exe就不动() {
        assert_eq!(
            resolve_autostart_action(Some("C:/app/TimeData.exe"), "C:/app/TimeData.exe", Enabled(true), UserDisabled(false)),
            AutostartAction::LeaveAlone
        );
    }

    #[test]
    fn 启动项被外部清掉时恢复() {
        // 实测踩过：NSIS 装新版会先卸载旧版，把启动项一并带走，升级后自启静默消失。
        // 记录路径与当前一致、但系统里已经没有启动项——必须恢复。
        assert_eq!(
            resolve_autostart_action(Some("C:/app/TimeData.exe"), "C:/app/TimeData.exe", Enabled(false), UserDisabled(false)),
            AutostartAction::Enable
        );
    }

    #[test]
    fn 换了安装路径时重新注册到新路径() {
        // 实测踩过：dev/release 构建先注册过，装了正式版后启动项仍指向构建产物，
        // 那个目录一清理，开机自启就无声失效。
        assert_eq!(
            resolve_autostart_action(Some("D:/build/timedata-desktop.exe"), "C:/app/TimeData.exe", Enabled(true), UserDisabled(false)),
            AutostartAction::Enable
        );
    }

    #[test]
    fn 旧版只写1的标记会被当成路径不符而重注册() {
        // 早期实现往标记里写的是 "1"，与任何真实路径都不相等，因此会被重新注册并改写成路径，
        // 不需要单独的迁移代码。
        assert_eq!(
            resolve_autostart_action(Some("1"), "C:/app/TimeData.exe", Enabled(true), UserDisabled(false)),
            AutostartAction::Enable
        );
    }

    // ---- 自启欠账（批 2）：用户在设置页关掉后，任何情形都不许回弹 ----

    #[test]
    fn user_disabled_beats_missing_registration() {
        // NSIS 升级清掉了启动项（enabled=false），但用户此前主动关过 → 不恢复。
        assert_eq!(
            resolve_autostart_action(None, r"C:\app\TimeData.exe", Enabled(false), UserDisabled(true)),
            AutostartAction::LeaveAlone
        );
    }

    #[test]
    fn user_disabled_beats_path_change() {
        assert_eq!(
            resolve_autostart_action(Some(r"C:\old\TimeData.exe"), r"C:\new\TimeData.exe", Enabled(true), UserDisabled(true)),
            AutostartAction::LeaveAlone
        );
    }

    #[test]
    fn user_disabled_leaves_matching_registration_alone() {
        assert_eq!(
            resolve_autostart_action(Some(r"C:\app\TimeData.exe"), r"C:\app\TimeData.exe", Enabled(true), UserDisabled(true)),
            AutostartAction::LeaveAlone
        );
    }

    // ---- toggleMain 真值表：前台可见才收起，其余一律带到前面 ----

    #[test]
    fn toggle_hides_only_when_visible_and_focused() {
        assert_eq!(resolve_toggle_action(Visible(true), Minimized(false), true), ToggleAction::Hide);
    }

    #[test]
    fn toggle_shows_when_hidden_or_minimized_or_unfocused() {
        assert_eq!(resolve_toggle_action(Visible(false), Minimized(false), false), ToggleAction::Show);
        assert_eq!(resolve_toggle_action(Visible(true), Minimized(true), false), ToggleAction::Show);
        assert_eq!(resolve_toggle_action(Visible(true), Minimized(false), false), ToggleAction::Show); // 被别的窗口盖住 → 提到前面
        assert_eq!(resolve_toggle_action(Visible(false), Minimized(true), false), ToggleAction::Show);
    }

    #[test]
    fn toggle_的三个词项各自都算数() {
        // 上面两条用例把 `visible && !minimized && focused` 整体换成 `if focused { Hide }`
        // 也全绿——所有 Show 用例的 focused 都是 false，另两位从没在「focused 为真」时被单独问过。
        // 这两个词项本身有价值：is_focused() 若哪天在隐藏 / 最小化的窗口上报 stale-true，
        // 它们正是防「按了反而再隐藏一次、永远出不来」的闸（刚修那个 bug 的镜像）。
        assert_eq!(resolve_toggle_action(Visible(false), Minimized(false), true), ToggleAction::Show);
        assert_eq!(resolve_toggle_action(Visible(true), Minimized(true), true), ToggleAction::Show);
    }

    // ---- 前台判定真值表：is_focused 与 Win32 前台句柄两路取或 ----

    const SELF_HWND: SelfHwnd = SelfHwnd(0x1234);
    const OTHER_ROOT: AncestorRoot = AncestorRoot(0x9999);
    const NO_ROOT: AncestorRoot = AncestorRoot(0);
    const NO_SELF: SelfHwnd = SelfHwnd(0);
    /// 与 `SELF_HWND` 同一个窗口，只是站在「前台归一后的句柄」这一侧。
    const SELF_ROOT: AncestorRoot = AncestorRoot(0x1234);

    #[test]
    fn is_focused_alone_is_enough() {
        // 老的唯一来源仍然算数：它报 true 就不必再问 Win32。
        assert!(resolve_is_foreground(true, OTHER_ROOT, SELF_HWND));
        assert!(resolve_is_foreground(true, NO_ROOT, NO_SELF));
    }

    #[test]
    fn foreground_hwnd_rescues_stale_is_focused() {
        // 本次修的那条：WebView2 子窗口吃走焦点，is_focused 报 false，但前台顶层就是本窗口。
        // 归一后句柄相等 → 判在前台 → toggleMain 才会走 Hide。
        assert!(resolve_is_foreground(false, SELF_ROOT, SELF_HWND));
    }

    #[test]
    fn other_app_in_foreground_is_not_ours() {
        assert!(!resolve_is_foreground(false, OTHER_ROOT, SELF_HWND));
    }

    #[test]
    fn null_handles_never_match_each_other() {
        // GetForegroundWindow 无前台窗口时返回 NULL，hwnd() 取不到时也是 0。
        // 「两边都拿不到」绝不能被当成「前台就是我」——那是凭空一次误 Hide。
        assert!(!resolve_is_foreground(false, NO_ROOT, NO_SELF));
    }

    #[test]
    fn missing_self_hwnd_degrades_to_is_focused_only() {
        // hwnd() 失败时不瞎猜，行为退回原样（此处 is_focused=false → 不在前台 → Show）。
        assert!(!resolve_is_foreground(false, OTHER_ROOT, NO_SELF));
        assert!(resolve_is_foreground(true, OTHER_ROOT, NO_SELF));
    }

    // ---- 归一到顶层这一步：合成在 shell.rs 里，装配层删不掉也传不歪 ----

    /// 前台是我们自己的 WebView2 子窗口时，`GetForegroundWindow()` 拿到的原始句柄。
    const WEBVIEW_CHILD_RAW: ForegroundRaw = ForegroundRaw(0x4321);
    /// 前台是本窗口自己（无子窗口插一脚）时的原始句柄。
    const SELF_RAW: ForegroundRaw = ForegroundRaw(0x1234);
    const OTHER_RAW: ForegroundRaw = ForegroundRaw(0x9999);
    const NO_FOREGROUND: ForegroundRaw = ForegroundRaw(0);

    #[test]
    fn 前台是自己的webview2子窗口时仍然收起() {
        // db28d8b5 修的那个真机 bug：WebView2 子窗口吃走焦点 → is_focused 报 false，
        // 且前台**原始**句柄 ≠ 主窗口句柄，只有归一到顶层（GA_ROOT）后才相等。
        // 忘了归一（拿 foreground_raw 去比）这条就翻成 Show——窗口永远收不起来。
        assert_eq!(
            resolve_toggle_from_window(
                Visible(true),
                Minimized(false),
                false,
                WEBVIEW_CHILD_RAW,
                SELF_ROOT,
                SELF_HWND,
            ),
            ToggleAction::Hide
        );
    }

    #[test]
    fn 没有前台窗口时不拿归一结果凑数() {
        // GetForegroundWindow 返回 NULL（0）时「谁都不在前台」，归一结果一律不参与比较——
        // 否则「两边都拿不到」会被当成「前台就是我」，凭空造出一次误 Hide。
        assert_eq!(
            resolve_toggle_from_window(Visible(true), Minimized(false), false, NO_FOREGROUND, SELF_ROOT, SELF_HWND),
            ToggleAction::Show
        );
    }

    #[test]
    fn 别的应用在前台时提到前面() {
        assert_eq!(
            resolve_toggle_from_window(Visible(true), Minimized(false), false, OTHER_RAW, OTHER_ROOT, SELF_HWND),
            ToggleAction::Show
        );
    }

    #[test]
    fn 前台判定为真也要窗口可见未最小化才收起() {
        // 合成函数不能把 resolve_toggle_action 的另外两个词项丢掉。
        assert_eq!(
            resolve_toggle_from_window(Visible(false), Minimized(false), true, SELF_RAW, SELF_ROOT, SELF_HWND),
            ToggleAction::Show
        );
        assert_eq!(
            resolve_toggle_from_window(Visible(true), Minimized(true), true, SELF_RAW, SELF_ROOT, SELF_HWND),
            ToggleAction::Show
        );
    }
}
