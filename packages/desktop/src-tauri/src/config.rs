use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const DEFAULT_PUNCH_CONFIRM_HOURS: f64 = 4.0;

/// 热键动作。内部标签 `action`，未来批次加 `Capture` / `Navigate { target: String }` 只是加成员。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum HotkeyAction {
    Punch,
    ToggleMain,
}

pub fn action_id(action: &HotkeyAction) -> &'static str {
    match action {
        HotkeyAction::Punch => "punch",
        HotkeyAction::ToggleMain => "toggleMain",
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyBinding {
    pub shortcut: String,
    #[serde(flatten)]
    pub action: HotkeyAction,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConfig {
    pub autostart_disabled: bool,
    pub punch_confirm_hours: f64,
    pub hotkeys: Vec<HotkeyBinding>,
}

impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            autostart_disabled: false,
            punch_confirm_hours: DEFAULT_PUNCH_CONFIRM_HOURS,
            hotkeys: Vec::new(),
        }
    }
}

/// 两层容错：整体 JSON 坏 → 默认配置；单条 hotkey 坏（未知动作 / 类型不对）→ 跳过该条。
/// 前者保「文件损坏不崩」，后者保「新版本写的动作在旧版本壳里不作废整个文件」。
pub fn parse_config(text: &str) -> DesktopConfig {
    let Ok(raw) = serde_json::from_str::<serde_json::Value>(text) else {
        return DesktopConfig::default();
    };
    let autostart_disabled = raw
        .get("autostartDisabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let punch_confirm_hours = raw
        .get("punchConfirmHours")
        .and_then(|v| v.as_f64())
        .filter(|h| h.is_finite() && *h > 0.0)
        .unwrap_or(DEFAULT_PUNCH_CONFIRM_HOURS);
    let hotkeys = raw
        .get("hotkeys")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value::<HotkeyBinding>(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();
    DesktopConfig {
        autostart_disabled,
        punch_confirm_hours,
        hotkeys,
    }
}

pub fn serialize_config(config: &DesktopConfig) -> String {
    serde_json::to_string_pretty(config).unwrap_or_else(|_| "{}".to_owned())
}

pub fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("desktop-config.json"))
}

pub fn load_config(app: &AppHandle) -> DesktopConfig {
    let Some(path) = config_path(app) else {
        return DesktopConfig::default();
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => parse_config(&text),
        Err(_) => DesktopConfig::default(),
    }
}

pub fn save_config(app: &AppHandle, config: &DesktopConfig) -> Result<(), String> {
    let path = config_path(app).ok_or_else(|| "无法取得配置目录".to_owned())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, serialize_config(config)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_normal_config() {
        let text = r#"{
            "autostartDisabled": true,
            "punchConfirmHours": 2.5,
            "hotkeys": [
                { "shortcut": "Ctrl+Alt+P", "action": "punch" },
                { "shortcut": "Ctrl+Alt+M", "action": "toggleMain" }
            ]
        }"#;
        let config = parse_config(text);
        assert!(config.autostart_disabled);
        assert_eq!(config.punch_confirm_hours, 2.5);
        assert_eq!(config.hotkeys.len(), 2);
        assert_eq!(config.hotkeys[0].shortcut, "Ctrl+Alt+P");
        assert_eq!(config.hotkeys[0].action, HotkeyAction::Punch);
        assert_eq!(config.hotkeys[1].action, HotkeyAction::ToggleMain);
    }

    #[test]
    fn broken_json_falls_back_to_default() {
        let config = parse_config("{ not json");
        assert_eq!(config, DesktopConfig::default());
    }

    #[test]
    fn empty_and_missing_fields_use_defaults() {
        let config = parse_config("{}");
        assert!(!config.autostart_disabled);
        assert_eq!(config.punch_confirm_hours, DEFAULT_PUNCH_CONFIRM_HOURS);
        assert!(config.hotkeys.is_empty());
    }

    #[test]
    fn unknown_action_entries_are_skipped_not_fatal() {
        // 未来版本写入的 navigate 条目，旧版本壳读到要跳过，不能整文件作废。
        let text = r#"{
            "hotkeys": [
                { "shortcut": "Ctrl+Alt+P", "action": "punch" },
                { "shortcut": "Ctrl+Alt+D", "action": "navigate", "target": "/diary" },
                { "shortcut": 42, "action": "punch" }
            ]
        }"#;
        let config = parse_config(text);
        assert_eq!(config.hotkeys.len(), 1);
        assert_eq!(config.hotkeys[0].action, HotkeyAction::Punch);
    }

    #[test]
    fn invalid_confirm_hours_falls_back() {
        assert_eq!(parse_config(r#"{"punchConfirmHours": 0}"#).punch_confirm_hours, DEFAULT_PUNCH_CONFIRM_HOURS);
        assert_eq!(parse_config(r#"{"punchConfirmHours": -1}"#).punch_confirm_hours, DEFAULT_PUNCH_CONFIRM_HOURS);
        assert_eq!(parse_config(r#"{"punchConfirmHours": "abc"}"#).punch_confirm_hours, DEFAULT_PUNCH_CONFIRM_HOURS);
    }

    #[test]
    fn serialize_then_parse_roundtrips() {
        let config = DesktopConfig {
            autostart_disabled: true,
            punch_confirm_hours: 6.0,
            hotkeys: vec![HotkeyBinding { shortcut: "Ctrl+Alt+P".into(), action: HotkeyAction::Punch }],
        };
        assert_eq!(parse_config(&serialize_config(&config)), config);
    }

    #[test]
    fn serialized_json_uses_camel_case_and_action_tag() {
        let config = DesktopConfig {
            autostart_disabled: false,
            punch_confirm_hours: 4.0,
            hotkeys: vec![HotkeyBinding { shortcut: "Ctrl+Alt+M".into(), action: HotkeyAction::ToggleMain }],
        };
        let text = serialize_config(&config);
        assert!(text.contains("\"autostartDisabled\""));
        assert!(text.contains("\"punchConfirmHours\""));
        assert!(text.contains("\"toggleMain\""));
    }

    #[test]
    fn action_id_maps_variants() {
        assert_eq!(action_id(&HotkeyAction::Punch), "punch");
        assert_eq!(action_id(&HotkeyAction::ToggleMain), "toggleMain");
    }
}
