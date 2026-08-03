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
        // is_finite 是防御性守卫，当前不可达：serde_json 在解析阶段就拒收 1e999 这类
        // 溢出字面量，JSON Number 里装不下 NaN/Infinity。留着只为上游行为变化时兜底，
        // 没有测试背书（测试只覆盖 > 0.0 这半边）。
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
    // "{}" 兜底当前不可达：DesktopConfig 没有非字符串键的 map，f64 也不会让序列化报错
    // （serde_json 对非有限数写 null 而非出错，何况上游已把阈值校验成有限正数）。
    // 不改成 expect 是因为生产壳里 panic 更糟；但要警惕：若某天真走到这里，"{}" 会经
    // save_config 落盘成一份空配置并返回 Ok——静默清掉用户全部设置。届时应改为让
    // save_config 返回 Err，而不是把空文件当成功写下去。
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
    let path = config_path(app).ok_or_else(|| "无法取得配置目录，配置未保存".to_owned())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建目录 {} 失败: {e}", dir.display()))?;
    }
    // 原子写：先落临时文件再 rename 覆盖（Windows 上 std::fs::rename 会替换既有文件）。
    // 直接 fs::write 截断重写的话，崩溃/断电落在写中途会留下半截 JSON——下次启动
    // parse_config 整体回默认，自启意图等设置全被静默清掉。
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serialize_config(config))
        .map_err(|e| format!("写入临时文件 {} 失败: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("替换配置文件 {} 失败: {e}", path.display()))
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
        // 逐字段断言而非与 Default::default() 比——那是自引用比较，Default 怎么改都恒等。
        // 4.0 用字面量不用常量：这条同时把默认阈值的契约值钉死。
        assert!(!config.autostart_disabled);
        assert_eq!(config.punch_confirm_hours, 4.0);
        assert!(config.hotkeys.is_empty());
    }

    #[test]
    fn empty_and_missing_fields_use_defaults() {
        let config = parse_config("{}");
        assert!(!config.autostart_disabled);
        assert_eq!(config.punch_confirm_hours, DEFAULT_PUNCH_CONFIRM_HOURS);
        assert!(config.hotkeys.is_empty());
    }

    #[test]
    fn explicit_autostart_false_parses_as_false() {
        // 挡「字段在场即 true」的错误实现——真值两端都要有断言（true 端在 parse_normal_config）。
        assert!(!parse_config(r#"{"autostartDisabled": false}"#).autostart_disabled);
    }

    #[test]
    fn non_bool_autostart_values_fall_back_to_false() {
        assert!(!parse_config(r#"{"autostartDisabled": "true"}"#).autostart_disabled);
        assert!(!parse_config(r#"{"autostartDisabled": 1}"#).autostart_disabled);
    }

    #[test]
    fn non_array_hotkeys_parses_to_empty_list() {
        let config = parse_config(r#"{"hotkeys": {}}"#);
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
