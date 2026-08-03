use serde::Serialize;
use std::collections::VecDeque;

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
pub struct HotkeyDispatcher {
    ready: bool,
    queue: VecDeque<HotkeyEventPayload>,
}

impl HotkeyDispatcher {
    pub fn new() -> Self {
        Self { ready: false, queue: VecDeque::new() }
    }

    /// ready 前入队返回 None；ready 后返回 Some，由调用方立即 emit。
    pub fn accept(&mut self, payload: HotkeyEventPayload) -> Option<HotkeyEventPayload> {
        if self.ready {
            Some(payload)
        } else {
            self.queue.push_back(payload);
            None
        }
    }

    /// 置 ready 并按按键序取出积压；再次调用返回空。
    pub fn mark_ready(&mut self) -> Vec<HotkeyEventPayload> {
        self.ready = true;
        self.queue.drain(..).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn punch_at(ms: u64) -> HotkeyEventPayload {
        HotkeyEventPayload { action: "punch".to_owned(), pressed_at_ms: ms }
    }

    #[test]
    fn queues_before_ready() {
        let mut d = HotkeyDispatcher::new();
        assert_eq!(d.accept(punch_at(100)), None);
        assert_eq!(d.accept(punch_at(200)), None);
    }

    #[test]
    fn mark_ready_drains_in_press_order() {
        let mut d = HotkeyDispatcher::new();
        d.accept(punch_at(100));
        d.accept(punch_at(200));
        let drained = d.mark_ready();
        assert_eq!(drained, vec![punch_at(100), punch_at(200)]);
    }

    #[test]
    fn delivers_directly_after_ready() {
        let mut d = HotkeyDispatcher::new();
        d.mark_ready();
        assert_eq!(d.accept(punch_at(300)), Some(punch_at(300)));
    }

    #[test]
    fn mark_ready_is_idempotent() {
        let mut d = HotkeyDispatcher::new();
        d.accept(punch_at(100));
        assert_eq!(d.mark_ready().len(), 1);
        assert!(d.mark_ready().is_empty());
    }
}
