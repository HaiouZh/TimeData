use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};

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
        HotkeyEventPayload { action: "punch".to_owned(), pressed_at_ms: ms }
    }

    fn capture_at(ms: u64) -> HotkeyEventPayload {
        HotkeyEventPayload { action: "capture".to_owned(), pressed_at_ms: ms }
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
