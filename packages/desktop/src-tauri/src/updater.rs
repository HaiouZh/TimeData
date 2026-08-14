//! 更新检查的可判定逻辑。系统调用（真去查、真去下）在 commands.rs，本文件全是纯函数。

/// 每 4 小时查一轮。常驻壳可能数周不重启，只靠启动检查等于不查。
pub const CHECK_INTERVAL_MS: u64 = 4 * 60 * 60 * 1000;
/// 启动后延迟 5 秒首查，不与启动抢资源。
pub const STARTUP_DELAY_MS: u64 = 5 * 1000;

/// 前端看到的四个状态串。「正在查」与「正在下」对用户是同一件事，不拆开——
/// 拆了前端要写两条一模一样的分支，而两者的文案与可点性完全相同。
pub const PHASE_DISABLED: &str = "disabled";
pub const PHASE_IDLE: &str = "idle";
pub const PHASE_BUSY: &str = "busy";
pub const PHASE_READY: &str = "ready";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloadDecision {
    Skip,
    Download,
}

pub fn resolve_phase(enabled: bool, busy: bool, has_ready: bool) -> &'static str {
    if !enabled {
        return PHASE_DISABLED;
    }
    if busy {
        return PHASE_BUSY;
    }
    if has_ready {
        return PHASE_READY;
    }
    PHASE_IDLE
}

pub fn should_check(last_checked_ms: Option<u64>, now_ms: u64, interval_ms: u64, manual: bool) -> bool {
    if manual {
        return true;
    }
    match last_checked_ms {
        None => true,
        // 饱和减法：系统时钟回拨时 now < last，裸减会 panic（debug）或环绕成巨值（release），
        // 后者表现为「时钟一回拨就疯狂查更新」。
        Some(last) => now_ms.saturating_sub(last) >= interval_ms,
    }
}

pub fn resolve_download_decision(ready_version: Option<&str>, available_version: &str) -> DownloadDecision {
    match ready_version {
        Some(ready) if ready == available_version => DownloadDecision::Skip,
        _ => DownloadDecision::Download,
    }
}

use serde::Serialize;
use std::sync::Mutex;
use tauri_plugin_updater::Update;

/// 更新状态。**下载缓冲随进程走**：`Vec<u8>` 与 `Update` 句柄都只活在内存里，
/// 应用重启即失效、需重下（约 6 秒）。不做磁盘缓存——省下的那几秒不值一套过期清理逻辑。
#[derive(Default)]
pub struct UpdaterInner {
    pub phase_is_busy: bool,
    pub ready_version: Option<String>,
    pub pending: Option<(Update, Vec<u8>)>,
    pub last_checked_ms: Option<u64>,
    pub last_error: Option<String>,
}

pub struct UpdaterState(pub Mutex<UpdaterInner>);

impl Default for UpdaterState {
    fn default() -> Self {
        UpdaterState(Mutex::new(UpdaterInner::default()))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterStatusDto {
    /// "disabled" | "idle" | "busy" | "ready"
    pub phase: String,
    pub current_version: String,
    pub available_version: Option<String>,
    pub last_checked_ms: Option<u64>,
    pub last_error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 禁用压倒一切：dev 构建下即使状态里残留着 ready 也不能显示成「可更新」，
    /// 否则点下去会拿 0.1.0 当基线去装一个「新版」。
    #[test]
    fn 禁用时无视其余入参() {
        assert_eq!(resolve_phase(false, true, true), PHASE_DISABLED);
        assert_eq!(resolve_phase(false, false, false), PHASE_DISABLED);
    }

    #[test]
    fn 忙碌优先于已就绪() {
        assert_eq!(resolve_phase(true, true, true), PHASE_BUSY);
    }

    #[test]
    fn 不忙且有货是已就绪() {
        assert_eq!(resolve_phase(true, false, true), PHASE_READY);
    }

    #[test]
    fn 不忙且没货是空闲() {
        assert_eq!(resolve_phase(true, false, false), PHASE_IDLE);
    }

    #[test]
    fn 从未查过时应当查() {
        assert!(should_check(None, 1_000, CHECK_INTERVAL_MS, false));
    }

    #[test]
    fn 未到间隔不查() {
        let last = 1_000_000;
        assert!(!should_check(Some(last), last + CHECK_INTERVAL_MS - 1, CHECK_INTERVAL_MS, false));
    }

    #[test]
    fn 刚好到间隔就查() {
        let last = 1_000_000;
        assert!(should_check(Some(last), last + CHECK_INTERVAL_MS, CHECK_INTERVAL_MS, false));
    }

    #[test]
    fn 手动检查绕过节流() {
        let last = 1_000_000;
        assert!(should_check(Some(last), last + 1, CHECK_INTERVAL_MS, true));
    }

    /// 系统时钟回拨时 now < last，饱和减法必须给 0 而不是 panic 或环绕成巨值。
    #[test]
    fn 时钟回拨不panic也不误判为该查() {
        let last = 5_000_000;
        assert!(!should_check(Some(last), 1_000, CHECK_INTERVAL_MS, false));
    }

    #[test]
    fn 手里没有时该下() {
        assert_eq!(resolve_download_decision(None, "26.814.2"), DownloadDecision::Download);
    }

    #[test]
    fn 手里就是这一版时跳过() {
        assert_eq!(resolve_download_decision(Some("26.814.2"), "26.814.2"), DownloadDecision::Skip);
    }

    /// 版本串不同即重下，不比大小：check() 已保证返回的比当前装机版新，
    /// 而 latest.json 被回滚时应当跟随回滚版本，不是死守手里更高的那个。
    #[test]
    fn 版本串不同即重下() {
        assert_eq!(resolve_download_decision(Some("26.814.2"), "26.813.1"), DownloadDecision::Download);
    }
}
