use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub const DEFAULT_PUNCH_CONFIRM_HOURS: f64 = 4.0;

/// 热键动作。内部标签 `action`。
///
/// `Navigate { target }` 是唯一带参的变体：内部标签 + `HotkeyBinding` 的 `#[serde(flatten)]`
/// 让 `{ "action": "navigate", "target": "/todo" }` 直接落位。**target 是不透明字符串**——
/// Rust 只保证它非空（见 `parse_config`），「是不是一个真实页面」由前端查
/// `isMainNavRoute` 判定。页面清单故意只存在于前端一处，不在这里复制第二份。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum HotkeyAction {
    Punch,
    ToggleMain,
    Capture,
    Navigate { target: String },
}

pub fn action_id(action: &HotkeyAction) -> &'static str {
    match action {
        HotkeyAction::Punch => "punch",
        HotkeyAction::ToggleMain => "toggleMain",
        HotkeyAction::Capture => "capture",
        HotkeyAction::Navigate { .. } => "navigate",
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
                .filter_map(|item| {
                    let binding = serde_json::from_value::<HotkeyBinding>(item.clone()).ok()?;
                    // serde 只挡得住 target **缺失**（反序列化失败）。空串是合法 String，
                    // 会一路通过——注册成功、按下去前端丢弃、屏幕上零反应。显式滤掉。
                    match &binding.action {
                        HotkeyAction::Navigate { target } if target.is_empty() => None,
                        _ => Some(binding),
                    }
                })
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

/// 配置文件写锁：所有 load→改→写回形态的命令先拿它再动文件。没有它，两个并发写命令
/// （如设置页同时改阈值与热键）会交错成「都基于旧文件各改各的、后写者静默抹掉先写者」
/// 的丢更新竞态。
///
/// **锁放在被保护资源这一侧**，不放在 `commands.rs`：走 `update_config` 的调用方根本
/// 不必「记得拿锁」，而将来在这个文件里加第五个写入口的人一眼就能看见它。
///
/// 需要自己编排读—改—写回（中途还要做别的副作用，比如开关系统自启、注册热键）的命令
/// 用 `config_write_guard` 显式拿。**持有 guard 期间不许再调 `update_config`**——
/// std 的 `Mutex` 不可重入，会当场死锁。
static CONFIG_WRITE_LOCK: Mutex<()> = Mutex::new(());

pub fn config_write_guard() -> std::sync::MutexGuard<'static, ()> {
    CONFIG_WRITE_LOCK.lock().expect("config write lock poisoned")
}

/// 读—改—写回的一站式入口，全程在写锁内。
///
/// `read_config_at` 失败时**直接往上抛、`mutate` 一次都不跑**。这不是省事，是要害：
/// 读失败（杀软/OneDrive 短暂独占文件）时若拿默认值继续走完 mutate 与写回，就会把
/// 用户全部快捷键抹成空表、把他关掉的自启重新打开，全程返回 Ok、零提示。
/// 详见 `read_config_at` 的三态说明。
pub fn update_config_at<F>(path: &Path, mutate: F) -> Result<DesktopConfig, String>
where
    F: FnOnce(&mut DesktopConfig),
{
    let mut cfg = read_config_at(path)?;
    mutate(&mut cfg);
    write_config_at(path, &cfg)?;
    Ok(cfg)
}

pub fn update_config<F>(app: &AppHandle, mutate: F) -> Result<DesktopConfig, String>
where
    F: FnOnce(&mut DesktopConfig),
{
    let _guard = config_write_guard();
    // 取不到配置目录时早退。与旧写法（load_config 回默认值、save_config 报这句错）
    // 外部可观察行为一致：同样的 Err、同样一个字没写。
    let Some(path) = config_path(app) else {
        return Err("无法取得配置目录，配置未保存".to_owned());
    };
    update_config_at(&path, mutate)
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
        // 未来版本写入的未知动作条目（此处以 teleport 冒充），旧版本壳读到要跳过，不能整文件作废。
        let text = r#"{
            "hotkeys": [
                { "shortcut": "Ctrl+Alt+P", "action": "punch" },
                { "shortcut": "Ctrl+Alt+D", "action": "teleport", "target": "/diary" },
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
        assert_eq!(action_id(&HotkeyAction::Navigate { target: "/todo".into() }), "navigate");
    }

    #[test]
    fn navigate_carries_target() {
        let config = parse_config(
            r#"{"hotkeys":[{"shortcut":"Ctrl+Alt+T","action":"navigate","target":"/todo"}]}"#,
        );
        assert_eq!(config.hotkeys.len(), 1);
        assert_eq!(
            config.hotkeys[0].action,
            HotkeyAction::Navigate { target: "/todo".to_owned() }
        );
    }

    #[test]
    fn navigate_without_target_is_skipped() {
        // serde 反序列化 Navigate { target: String } 时缺字段直接失败，filter_map 跳过该条。
        let config = parse_config(r#"{"hotkeys":[{"shortcut":"Ctrl+Alt+T","action":"navigate"}]}"#);
        assert!(config.hotkeys.is_empty());
    }

    #[test]
    fn navigate_with_empty_target_is_skipped() {
        // **空串 serde 是收的**（String 可以为空），必须显式过滤——否则这条绑定注册成功、
        // 按下去前端拿到空 target 丢弃，表现为「按了没反应」。
        let config = parse_config(r#"{"hotkeys":[{"shortcut":"Ctrl+Alt+T","action":"navigate","target":""}]}"#);
        assert!(config.hotkeys.is_empty());
    }

    #[test]
    fn navigate_survives_round_trip() {
        // flatten 写回丢字段是静默的：存一次就把 target 抹掉，下次启动这条绑定整个消失。
        let original = DesktopConfig {
            autostart_disabled: false,
            punch_confirm_hours: 4.0,
            hotkeys: vec![HotkeyBinding {
                shortcut: "Ctrl+Alt+T".into(),
                action: HotkeyAction::Navigate { target: "/todo".into() },
            }],
        };
        let reparsed = parse_config(&serialize_config(&original));
        assert_eq!(reparsed.hotkeys, original.hotkeys);
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
        // parse_config 的 filter_map 前向兼容只在**读**路径上成立：新版本写下的未知动作条目
        // （此处以 teleport 冒充 navigate 当年的角色）被旧版本读到会跳过，而旧版本的任何一次
        // 保存都是全量覆盖——跳过的条目就此消失。
        // 这是当前接受的行为（Rust 是配置文件唯一写者，跨版本回退属罕见操作），
        // 但它必须写在纸面上：哪天要改成「保留未知条目」，这条用例就是改动的入口。
        let dir = temp_dir_for("forward-compat");
        let path = dir.join("desktop-config.json");
        std::fs::write(
            &path,
            r#"{"hotkeys":[{"shortcut":"Ctrl+Alt+P","action":"punch"},{"shortcut":"Ctrl+Alt+D","action":"teleport","target":"/diary"}]}"#,
        )
        .expect("造一份带未来条目的文件");

        let loaded = read_config_at(&path).expect("读");
        assert_eq!(loaded.hotkeys.len(), 1, "读的时候跳过未知条目、其余照用");

        write_config_at(&path, &loaded).expect("原样存回");
        assert_eq!(read_config_at(&path).expect("再读").hotkeys.len(), 1);
        assert!(!std::fs::read_to_string(&path).expect("读原文").contains("teleport"));
    }

    #[test]
    fn 读失败时不跑mutate也不写文件() {
        // 用一个**目录**冒充配置文件路径：read_to_string 一个目录必然失败，
        // 且错误 kind 不是 NotFound——正好造出 read_config_at 的「读失败」那一档。
        let dir = temp_dir_for("update-read-fail");
        // 写入痕迹落在 dir 的**兄弟**路径上，`temp_dir_for` 的 remove_dir_all 扫不到它。
        // 断言前先清一次：否则某一次失败（或对本函数做变异验证）留下的 tmp 会让这条测试
        // 此后永远红——而清理若只写在结尾，第一次 panic 就再也执行不到了。
        let write_trace = dir.with_extension("json.tmp");
        let _ = std::fs::remove_file(&write_trace);

        let mut mutate_ran = false;
        let err = update_config_at(&dir, |cfg| {
            mutate_ran = true;
            cfg.punch_confirm_hours = 9.0;
        })
        .expect_err("读失败必须往上抛，不许当成默认值继续");

        // 这条断言排在最前面是有意的：把 `?` 换成 `.unwrap_or_default()` 时，写回同样会
        // 失败、函数照旧返回 Err，只是错误换了来源——若先断错误文案，报出来的是「文案不对」
        // 这种次要现象。先断 mutate，退化的性质才会直接写在失败信息里。
        assert!(
            !mutate_ran,
            "读失败时 mutate 一次都不许跑——跑了就意味着后面还会拿这份伪造的配置全量写回，\
             用户的快捷键和自启意图会被静默抹掉"
        );
        assert!(err.contains("读取配置文件"), "错误信息要指明是读取失败，实际：{err}");
        assert!(!write_trace.exists(), "读失败时不许产生任何写入痕迹");
    }
}
