use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};

use crate::config::{action_id, HotkeyAction};

/// 热键事件名：Rust `emit` 与前端 `listen` 之间唯一的约定，两端没有共享类型。
/// **Rust 侧的字面量只准出现在这一处**——`commands.rs` 有两处 emit（实时投递、就绪后补投），
/// 各写一遍字面量时改事件名很容易只改到第一处：闸照绿、日常按键正常，唯独「WebView 就绪前
/// 排队的那批」发的是旧名字、前端永远收不到，正好打掉「开机第一秒按下也生效」这条承诺。
/// 配置闸（check-desktop-config.mjs）据此断言：commands.rs 里不许有裸字面量 emit，
/// 前端 api.ts 的 listen 名必须逐字等于这里的值。
pub const HOTKEY_EVENT: &str = "desktop-hotkey";

/// 投递给 WebView 的热键事件。pressed_at_ms 是 Rust 侧按键那一刻，
/// 排队补投也不变——封口时刻以按键为准（spec §五.3）。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyEventPayload {
    pub action: String,
    pub pressed_at_ms: u64,
    /// 只有 `navigate` 用得上；其余动作这个键**不出现在载荷里**（不是 `null`）——
    /// 前端类型声明的是 `target?: string`，序列化出 null 会让 `=== undefined` 的判断失效。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

/// 从动作构造投递载荷。
///
/// **抽成纯函数只为立一道闸**：这段构造原本内联在 `commands.rs::handle_hotkey` 里，而那个
/// 函数要 `AppHandle`、单测够不着它，于是「navigate 有没有把 target 带上」在整条链上一道闸
/// 都没有。实测变异确认过：把 target 恒置 `None`，`cargo test` 全绿、两道配置闸全绿、
/// 前端全量测试全绿——而热键按下去零效果（前端拿不到 target 就丢弃）。
/// 那正是本批立闸要堵的形状，所以它自己不能是个洞。
pub fn hotkey_payload(action: &HotkeyAction, pressed_at_ms: u64) -> HotkeyEventPayload {
    HotkeyEventPayload {
        action: action_id(action).to_owned(),
        pressed_at_ms,
        target: match action {
            HotkeyAction::Navigate { target } => Some(target.clone()),
            // 不用 `_` 兜底：加第二个带参动作时漏写它的 arm，这里要编译红，
            // 而不是静默发出一个丢了参数的载荷（那正是本函数被抽出来要堵的形状）。
            HotkeyAction::Punch | HotkeyAction::ToggleMain | HotkeyAction::Capture => None,
        },
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationOutcome {
    pub shortcut: String,
    pub action: String,
    pub ok: bool,
    pub error: Option<String>,
}

/// WebView 就绪前把事件排队，就绪后直投。调用方持 Mutex，本体单线程逻辑。
///
/// **按 label 分组**：两个窗口各有各的就绪时刻，共用一个 ready 标志会让先起来的那个
/// 窗口替另一个「宣布就绪」，另一个窗口的事件就直投给了还没挂监听的 WebView——
/// 表现是开机头几秒按热键静默丢失，正是上一批花力气堵的那类「按了没反应也没提示」。
pub struct HotkeyDispatcher {
    ready: HashSet<String>,
    queues: HashMap<String, VecDeque<HotkeyEventPayload>>,
}

impl HotkeyDispatcher {
    pub fn new() -> Self {
        Self { ready: HashSet::new(), queues: HashMap::new() }
    }

    /// 该 label 就绪前入队返回 None；就绪后返回 Some，由调用方立即 emit_to 该 label。
    pub fn accept(&mut self, label: &str, payload: HotkeyEventPayload) -> Option<HotkeyEventPayload> {
        if self.ready.contains(label) {
            Some(payload)
        } else {
            self.queues.entry(label.to_owned()).or_default().push_back(payload);
            None
        }
    }

    /// 置该 label 为就绪并按按键序取出它的积压；再次调用返回空。
    pub fn mark_ready(&mut self, label: &str) -> Vec<HotkeyEventPayload> {
        self.ready.insert(label.to_owned());
        self.queues.remove(label).map(Vec::from).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn punch_at(ms: u64) -> HotkeyEventPayload {
        HotkeyEventPayload { action: "punch".to_owned(), pressed_at_ms: ms, target: None }
    }

    #[test]
    fn navigate_payload_carries_target() {
        // 这条锁的是「navigate 事件必须把目标页带过去」。没有它，把 target 恒置 None
        // 不会让任何测试红，而热键的可观察结果是零——前端收到没有 target 的 navigate
        // 会直接丢弃。实测变异确认过这个缺口，本测试是为它补的。
        let payload = hotkey_payload(&HotkeyAction::Navigate { target: "/todo".to_owned() }, 123);
        assert_eq!(payload.action, "navigate");
        assert_eq!(payload.target.as_deref(), Some("/todo"));
        assert_eq!(payload.pressed_at_ms, 123);
    }

    #[test]
    fn non_navigate_payload_has_no_target() {
        // 反向也锁住：别的动作带着 target 是无意义状态，前端会拿它当真。
        assert_eq!(hotkey_payload(&HotkeyAction::Punch, 1).target, None);
        assert_eq!(hotkey_payload(&HotkeyAction::Capture, 1).target, None);
        assert_eq!(hotkey_payload(&HotkeyAction::ToggleMain, 1).target, None);
    }

    #[test]
    fn non_navigate_payload_omits_target_key() {
        // 前端类型声明的是 `target?: string`。None 不带 skip_serializing_if 时会被
        // 序列化成 "target": null 且键恒在——类型在撒谎，「其余动作一律不带」在 JSON
        // 层面不成立。这里锁的是键**根本不存在**（不是值为 null）。
        let punch = serde_json::to_value(hotkey_payload(&HotkeyAction::Punch, 1)).expect("序列化 punch");
        assert!(!punch.as_object().expect("应是对象").contains_key("target"));

        let navigate = serde_json::to_value(hotkey_payload(
            &HotkeyAction::Navigate { target: "/todo".to_owned() },
            1,
        ))
        .expect("序列化 navigate");
        let obj = navigate.as_object().expect("应是对象");
        assert!(obj.contains_key("target"), "navigate 载荷必须带 target 键");
        assert_eq!(obj.get("target").and_then(|v| v.as_str()), Some("/todo"));
    }

    fn capture_at(ms: u64) -> HotkeyEventPayload {
        HotkeyEventPayload { action: "capture".to_owned(), pressed_at_ms: ms, target: None }
    }

    #[test]
    fn queues_before_ready() {
        let mut d = HotkeyDispatcher::new();
        assert_eq!(d.accept("main", punch_at(100)), None);
        assert_eq!(d.accept("main", punch_at(200)), None);
    }

    #[test]
    fn mark_ready_drains_in_press_order() {
        let mut d = HotkeyDispatcher::new();
        d.accept("main", punch_at(100));
        d.accept("main", punch_at(200));
        assert_eq!(d.mark_ready("main"), vec![punch_at(100), punch_at(200)]);
    }

    #[test]
    fn delivers_directly_after_ready() {
        let mut d = HotkeyDispatcher::new();
        d.mark_ready("main");
        assert_eq!(d.accept("main", punch_at(300)), Some(punch_at(300)));
    }

    #[test]
    fn mark_ready_is_idempotent() {
        let mut d = HotkeyDispatcher::new();
        d.accept("main", punch_at(100));
        assert_eq!(d.mark_ready("main").len(), 1);
        assert!(d.mark_ready("main").is_empty());
    }

    #[test]
    fn one_window_ready_does_not_release_another_queue() {
        // 两个窗口各有各的就绪时刻。共用一个 ready 标志时，主窗口先起来就会让浮窗那批
        // 「直投」——投给一个还没挂监听的 WebView，等于开机头几秒按 capture 全丢。
        let mut d = HotkeyDispatcher::new();
        d.accept("capture", capture_at(100));
        assert!(d.mark_ready("main").is_empty());
        assert_eq!(d.accept("capture", capture_at(200)), None);
        assert_eq!(d.mark_ready("capture"), vec![capture_at(100), capture_at(200)]);
    }

    #[test]
    fn queues_are_per_label() {
        let mut d = HotkeyDispatcher::new();
        d.accept("main", punch_at(1));
        d.accept("capture", capture_at(2));
        assert_eq!(d.mark_ready("main"), vec![punch_at(1)]);
        assert_eq!(d.mark_ready("capture"), vec![capture_at(2)]);
    }
}
