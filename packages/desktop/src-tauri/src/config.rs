use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const DEFAULT_PUNCH_CONFIRM_HOURS: f64 = 4.0;

/// 热键动作。内部标签 `action`。
///
/// **加带参变体（`Navigate { target: String }`）不是「只是加成员」**：参数位只在
/// 配置文件这一层预留得住（内部标签 + `#[serde(flatten)]` 装得下
/// `{ "action": "navigate", "target": "/diary" }`）。往前端去的两层都是扁的——
/// `hotkeys::HotkeyEventPayload.action` 是 `String`，前端 `DesktopHotkeyBinding.action`
/// 是字符串联合类型，参数根本传不过去。真要加带参动作，这三层的形状要一起改。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum HotkeyAction {
    Punch,
    ToggleMain,
    Capture,
}

pub fn action_id(action: &HotkeyAction) -> &'static str {
    match action {
        HotkeyAction::Punch => "punch",
        HotkeyAction::ToggleMain => "toggleMain",
        HotkeyAction::Capture => "capture",
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

/// 读配置的**三态**：文件不存在 → 默认值；读失败 → `Err`；读到了 → 解析结果。
///
/// 「读失败」与「文件不存在」必须分开，否则杀软 / OneDrive / 备份工具短暂独占文件的那一瞬
/// 会被当成「用户还没配过任何东西」：调用方拿着全默认值（`hotkeys: []`、
/// `autostartDisabled: false`）去做 load→改→**全量覆盖**写回，一次保存就把用户全部快捷键
/// 永久抹掉、把关掉的自启重新打开，全程返回 `Ok`、零提示。
///
/// 与 `parse_config` 的两层容错不是一回事：那边是**内容真坏了**（JSON 语法错、认不出的
/// 动作），此处是**内容可能好端端的、只是这一刻读不到**。前者可以回默认值继续，后者不行。
pub fn read_config_at(path: &Path) -> Result<DesktopConfig, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(parse_config(&text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(DesktopConfig::default()),
        Err(e) => Err(format!("读取配置文件 {} 失败：{e}", path.display())),
    }
}

/// 原子写：先落临时文件再 rename 覆盖（Windows 上 std::fs::rename 会替换既有文件）。
/// 直接 fs::write 截断重写的话，崩溃/断电落在写中途会留下半截 JSON——下次启动
/// parse_config 整体回默认，自启意图等设置全被静默清掉。
pub fn write_config_at(path: &Path, config: &DesktopConfig) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建目录 {} 失败: {e}", dir.display()))?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serialize_config(config))
        .map_err(|e| format!("写入临时文件 {} 失败: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("替换配置文件 {} 失败: {e}", path.display()))
}

pub fn load_config(app: &AppHandle) -> Result<DesktopConfig, String> {
    // 取不到配置目录 = 这台机器上根本没有这份文件，与「文件不存在」同类，回默认值。
    // 真要落盘时 save_config 会拿同一个 None 报错，不会静默丢。
    let Some(path) = config_path(app) else {
        return Ok(DesktopConfig::default());
    };
    read_config_at(&path)
}

pub fn save_config(app: &AppHandle, config: &DesktopConfig) -> Result<(), String> {
    let path = config_path(app).ok_or_else(|| "无法取得配置目录，配置未保存".to_owned())?;
    write_config_at(&path, config)
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

    // ---- 读写落盘：三态 + 往返不变量（`load_config` / `save_config` 此前零覆盖）----

    /// 每条用例一个独立目录，名字带进程 id，`cargo test` 并行跑也不互撞。
    fn temp_dir_for(name: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("timedata-config-test-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("建临时目录");
        dir
    }

    fn sample_config() -> DesktopConfig {
        DesktopConfig {
            autostart_disabled: true,
            punch_confirm_hours: 2.5,
            hotkeys: vec![
                HotkeyBinding { shortcut: "Ctrl+Alt+P".into(), action: HotkeyAction::Punch },
                HotkeyBinding { shortcut: "Ctrl+Alt+M".into(), action: HotkeyAction::ToggleMain },
            ],
        }
    }

    #[test]
    fn 文件不存在时读成默认值而不是报错() {
        // 首次启动的正常路径：没配过 = 默认配置，不能当成故障。
        let dir = temp_dir_for("missing");
        let config = read_config_at(&dir.join("desktop-config.json")).expect("文件不存在不该报错");
        assert!(!config.autostart_disabled);
        assert_eq!(config.punch_confirm_hours, 4.0);
        assert!(config.hotkeys.is_empty());
    }

    #[test]
    fn 读失败必须是err不许伪造成默认值() {
        // 用「该是文件的位置上放了个目录」模拟被独占 / 无权限：read_to_string 必然失败且不是 NotFound。
        // 这条一红就说明读失败又被归到默认值那一侧——写命令会拿全默认覆盖真文件，
        // 用户全部快捷键消失、关掉的自启回弹，全程返回 Ok、零提示。
        let dir = temp_dir_for("unreadable");
        let path = dir.join("desktop-config.json");
        std::fs::create_dir_all(&path).expect("占位目录");
        let err = read_config_at(&path).expect_err("读不到必须是 Err");
        assert!(err.contains("读取配置文件"), "错误信息要能读懂：{err}");
    }

    #[test]
    fn 写了再读拿回同一份配置() {
        let dir = temp_dir_for("roundtrip");
        let path = dir.join("desktop-config.json");
        let config = sample_config();
        write_config_at(&path, &config).expect("写盘");
        assert_eq!(read_config_at(&path).expect("回读"), config);
    }

    #[test]
    fn 写盘会顺手建出不存在的目录() {
        let dir = temp_dir_for("mkdir");
        let path = dir.join("nested").join("desktop-config.json");
        write_config_at(&path, &sample_config()).expect("写盘要能自建目录");
        assert!(path.exists());
    }

    #[test]
    fn 认不出的条目在一次保存后就永久没了() {
        // parse_config 的 filter_map 前向兼容只在**读**路径上成立：新版本写下的 navigate 条目
        // 被旧版本读到会跳过，而旧版本的任何一次保存都是全量覆盖——跳过的条目就此消失。
        // 这是当前接受的行为（Rust 是配置文件唯一写者，跨版本回退属罕见操作），
        // 但它必须写在纸面上：哪天要改成「保留未知条目」，这条用例就是改动的入口。
        let dir = temp_dir_for("forward-compat");
        let path = dir.join("desktop-config.json");
        std::fs::write(
            &path,
            r#"{"hotkeys":[{"shortcut":"Ctrl+Alt+P","action":"punch"},{"shortcut":"Ctrl+Alt+D","action":"navigate","target":"/diary"}]}"#,
        )
        .expect("造一份带未来条目的文件");

        let loaded = read_config_at(&path).expect("读");
        assert_eq!(loaded.hotkeys.len(), 1, "读的时候跳过未知条目、其余照用");

        write_config_at(&path, &loaded).expect("原样存回");
        assert_eq!(read_config_at(&path).expect("再读").hotkeys.len(), 1);
        assert!(!std::fs::read_to_string(&path).expect("读原文").contains("navigate"));
    }
}
