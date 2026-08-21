use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub const DEFAULT_PUNCH_CONFIRM_HOURS: f64 = 4.0;

/// windowState 宽高的量级上限（物理像素）。只挡荒谬巨值，不约束真实显示器。
pub const MAX_WINDOW_DIMENSION: f64 = 100_000.0;

/// 主窗口上次的几何状态（物理像素）。x/y 允许负值——副屏在主屏左侧/上方时就是负的。
/// 解析守卫只做类型层（宽高 > 0 且有限）；「位置是否还在某个显示器内」是语义校验，
/// 归恢复层（`shell::position_on_any_monitor`），两层各管各的。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
}

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

/// 一条绑定的**结构**是否完整。Rust 只管这一层——「有哪些页面」是前端的事。
///
/// 读写两路都要过：`parse_config` 挡住手改配置文件写进来的坏条目，`replace_hotkeys`
/// 挡住不经设置页 UI 的写入（导入、CLI、将来的第二个写入口）。只在读路径过滤时，
/// 空 target 绑定会「注册成功 → 按下去零反应 → 下次读配置整条凭空消失」。
///
/// `trim` 不是多余：`" "` 是合法非空 String，`is_empty()` 放行它，而它同样不是有效目标。
pub fn binding_is_structurally_valid(binding: &HotkeyBinding) -> bool {
    match &binding.action {
        HotkeyAction::Navigate { target } => !target.trim().is_empty(),
        HotkeyAction::Punch | HotkeyAction::ToggleMain | HotkeyAction::Capture => true,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_state: Option<WindowState>,
}

impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            autostart_disabled: false,
            punch_confirm_hours: DEFAULT_PUNCH_CONFIRM_HOURS,
            hotkeys: Vec::new(),
            window_state: None,
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
                    // serde 只挡得住 target **缺失**（反序列化失败）。空串 / 空白串是合法 String，
                    // 会一路通过——注册成功、按下去前端丢弃、屏幕上零反应。显式滤掉。
                    if binding_is_structurally_valid(&binding) {
                        Some(binding)
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    // 整体作废不做半份降级（拍板⑤）：坏一个字段整个当没有，回退 conf 默认几何。
    // 量级上限挡「合法但荒谬」的巨值（1e30 这类有限数会穿透 > 0 守卫，到恢复层参与
    // 坐标运算）；10 万像素远超任何真实显示器，又远低于 i32 边界。
    let window_state = raw
        .get("windowState")
        .and_then(|value| serde_json::from_value::<WindowState>(value.clone()).ok())
        .filter(|state| {
            state.width.is_finite()
                && state.width > 0.0
                && state.width <= MAX_WINDOW_DIMENSION
                && state.height.is_finite()
                && state.height > 0.0
                && state.height <= MAX_WINDOW_DIMENSION
        });
    DesktopConfig {
        autostart_disabled,
        punch_confirm_hours,
        hotkeys,
        window_state,
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

/// 「读一份配置、换掉热键表、写回」的编排。
///
/// 两次 IO 注入进来只为一件事：让「读失败就不写文件」这条**测得到**。命令本体
/// （`commands::set_hotkeys`）要 `AppHandle`，那一层测不了，闸只能立在这里。
///
/// 返回写进去的那份热键表，调用方拿它去注册——**不要改成返回整个 config**，
/// 调用方只需要这一项。
pub fn replace_hotkeys<L, S>(
    bindings: Vec<HotkeyBinding>,
    load: L,
    mut save: S,
) -> Result<Vec<HotkeyBinding>, String>
where
    L: FnOnce() -> Result<DesktopConfig, String>,
    S: FnMut(&DesktopConfig) -> Result<(), String>,
{
    let mut cfg = load()?;
    cfg.hotkeys = bindings
        .into_iter()
        .filter(binding_is_structurally_valid)
        .collect();
    save(&cfg)?;
    Ok(cfg.hotkeys)
}

/// 「开/关系统自启 + 落盘意图」的编排。与 `replace_hotkeys` 同款形状，三个口子注入：
/// `load`（读配置）、`apply_system`（系统自启开/关）、`save`（写配置）。
///
/// 注入进来只为一件事：让「读失败时系统状态一个字都不改」这条**测得到**。命令本体
/// （`commands::set_autostart_enabled`）要 `AppHandle`，那一层测不了，闸只能立在这里。
/// 顺序是先读、再动系统、最后落盘——读失败当场早退，系统调用一次都不许发生。
pub fn apply_autostart<L, A, S>(
    enabled: bool,
    load: L,
    mut apply_system: A,
    mut save: S,
) -> Result<(), String>
where
    L: FnOnce() -> Result<DesktopConfig, String>,
    A: FnMut(bool) -> Result<(), String>,
    S: FnMut(&DesktopConfig) -> Result<(), String>,
{
    // 先读、读不到就走人：这一句必须在 apply_system 之前，读失败时系统状态一个字没改。
    let mut cfg = load()?;
    if enabled {
        apply_system(true)?;
        cfg.autostart_disabled = false;
        save(&cfg).map_err(|e| format!("自启已开启，但关闭意图记录失败：{e}"))?;
    } else {
        apply_system(false)?;
        cfg.autostart_disabled = true;
        save(&cfg).map_err(|e| format!("自启已关闭，但意图记录失败：{e}"))?;
    }
    Ok(())
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
            window_state: None,
        };
        assert_eq!(parse_config(&serialize_config(&config)), config);
    }

    #[test]
    fn serialized_json_uses_camel_case_and_action_tag() {
        let config = DesktopConfig {
            autostart_disabled: false,
            punch_confirm_hours: 4.0,
            hotkeys: vec![HotkeyBinding { shortcut: "Ctrl+Alt+M".into(), action: HotkeyAction::ToggleMain }],
            window_state: None,
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
    fn navigate_with_blank_target_is_skipped() {
        // 空串的升级版：`" "` 是合法非空 String，`is_empty()` 放行它、`trim()` 才能挡住——
        // 它同样会注册成功、按下去前端丢弃、屏幕上零反应。
        let config = parse_config(r#"{"hotkeys":[{"shortcut":"Ctrl+Alt+T","action":"navigate","target":"  "}]}"#);
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
            window_state: None,
        };
        let reparsed = parse_config(&serialize_config(&original));
        assert_eq!(reparsed.hotkeys, original.hotkeys);
    }

    // ---- windowState：主窗口几何记忆（spec 2026-08-21）----

    #[test]
    fn 合法window_state被接受含负坐标() {
        // 副屏在左/上时坐标是负的，合法值不许被误杀。
        let parsed = parse_config(
            r#"{"windowState": {"width": 1200, "height": 900, "x": -1920, "y": 40, "maximized": true}}"#,
        );
        assert_eq!(
            parsed.window_state,
            Some(WindowState { width: 1200.0, height: 900.0, x: -1920, y: 40, maximized: true })
        );
    }

    #[test]
    fn 缺window_state字段读成none且写回不带该字段() {
        // skip_serializing_if 是旧文件的干净性契约：没这功能的配置写回后一个字不多。
        let config = parse_config("{}");
        assert!(config.window_state.is_none());
        assert!(!serialize_config(&config).contains("windowState"));
    }

    #[test]
    fn 坏类型的window_state整体作废() {
        // 整体作废不做半份降级（拍板⑤）：坏一个字段整个当没有，回退 conf 默认几何。
        assert!(parse_config(r#"{"windowState": "nope"}"#).window_state.is_none());
        assert!(parse_config(
            r#"{"windowState": {"width": "big", "height": 800, "x": 0, "y": 0, "maximized": false}}"#
        )
        .window_state
        .is_none());
        // 缺字段 serde 直接反序列化失败，同样整体作废。
        assert!(parse_config(r#"{"windowState": {"width": 1100, "height": 800}}"#).window_state.is_none());
    }

    #[test]
    fn 非正宽高的window_state整体作废() {
        assert!(parse_config(
            r#"{"windowState": {"width": 0, "height": 800, "x": 0, "y": 0, "maximized": false}}"#
        )
        .window_state
        .is_none());
        assert!(parse_config(
            r#"{"windowState": {"width": -5, "height": 800, "x": 0, "y": 0, "maximized": false}}"#
        )
        .window_state
        .is_none());
    }

    #[test]
    fn 荒谬巨值的window_state整体作废() {
        // 有限巨值穿透「> 0 且有限」守卫后，到恢复层参与坐标运算会溢出（debug panic）——
        // 在 parse 这道门就挡掉。1e30 合法有限，专门选它当探针。
        assert!(parse_config(
            r#"{"windowState": {"width": 1e30, "height": 800, "x": 0, "y": 0, "maximized": false}}"#
        )
        .window_state
        .is_none());
        assert!(parse_config(
            r#"{"windowState": {"width": 1100, "height": 1e30, "x": 0, "y": 0, "maximized": false}}"#
        )
        .window_state
        .is_none());
    }

    #[test]
    fn window_state往返不丢字段() {
        let mut config = sample_config();
        config.window_state = Some(WindowState { width: 1400.0, height: 900.0, x: 100, y: -40, maximized: true });
        assert_eq!(parse_config(&serialize_config(&config)), config);
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
            window_state: None,
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

    #[test]
    fn 读失败时不换热键也不写文件() {
        // 这条守的是 set_hotkeys 的那个 `?`。把它改成 unwrap_or_default() 时必须红——
        // 否则杀软/OneDrive 短暂独占文件的那一瞬会被当成「用户没配过任何东西」，
        // 一次保存就把全部快捷键永久抹掉，且全程返回 Ok、零提示。
        let mut saved = false;
        let result = replace_hotkeys(
            vec![HotkeyBinding { shortcut: "Ctrl+Alt+P".into(), action: HotkeyAction::Punch }],
            || Err("读取配置文件 X 失败".to_owned()),
            |_| {
                saved = true;
                Ok(())
            },
        );
        assert!(!saved, "读失败时一个字都不许写");
        assert!(result.is_err());
    }

    #[test]
    fn 换热键只动热键那一项其余原样带过() {
        // 全量覆盖写回时漏带字段就是静默清设置，所以要逐项确认其余字段原封不动。
        let mut written: Option<DesktopConfig> = None;
        let result = replace_hotkeys(
            vec![HotkeyBinding {
                shortcut: "Ctrl+Alt+T".into(),
                action: HotkeyAction::Navigate { target: "/todo".into() },
            }],
            || {
                Ok(DesktopConfig {
                    autostart_disabled: true,
                    punch_confirm_hours: 2.5,
                    hotkeys: vec![HotkeyBinding { shortcut: "Ctrl+Alt+P".into(), action: HotkeyAction::Punch }],
                    window_state: None,
                })
            },
            |cfg| {
                written = Some(cfg.clone());
                Ok(())
            },
        );
        let returned = result.expect("正常路径应成功");
        let written = written.expect("正常路径必须落盘");
        assert_eq!(written.hotkeys, returned);
        assert_eq!(written.hotkeys.len(), 1);
        assert_eq!(written.hotkeys[0].shortcut, "Ctrl+Alt+T");
        assert!(written.autostart_disabled, "自启意图不许被顺手改掉");
        assert_eq!(written.punch_confirm_hours, 2.5, "打点阈值不许被顺手改掉");
    }

    #[test]
    fn 写失败时把错误原样往上送() {
        // 落盘失败必须让用户看见——吞掉它就是「看着保存成功、壳里其实没换」。
        let result = replace_hotkeys(
            vec![],
            || Ok(DesktopConfig::default()),
            |_| Err("替换配置文件 X 失败".to_owned()),
        );
        assert_eq!(result.unwrap_err(), "替换配置文件 X 失败");
    }

    #[test]
    fn replace_hotkeys_drops_invalid_bindings() {
        // 写路径也要过同一道结构闸：只在读路径过滤时，空 target 绑定会「注册成功 →
        // 按下去零反应 → 下次读配置整条凭空消失」。这里走 replace_hotkeys 直接喂坏条目，
        // 返回值与落盘内容都必须只剩合法那条。
        let mut written: Option<DesktopConfig> = None;
        let result = replace_hotkeys(
            vec![
                HotkeyBinding {
                    shortcut: "Ctrl+Alt+T".into(),
                    action: HotkeyAction::Navigate { target: "/todo".into() },
                },
                HotkeyBinding {
                    shortcut: "Ctrl+Alt+X".into(),
                    action: HotkeyAction::Navigate { target: "  ".into() },
                },
            ],
            || Ok(DesktopConfig::default()),
            |cfg| {
                written = Some(cfg.clone());
                Ok(())
            },
        );
        let returned = result.expect("正常路径应成功");
        let written = written.expect("正常路径必须落盘");
        assert_eq!(returned.len(), 1, "坏条目不许进返回值");
        assert_eq!(returned[0].shortcut, "Ctrl+Alt+T");
        assert_eq!(written.hotkeys, returned, "落盘内容与返回值一致，都不含坏条目");
    }

    #[test]
    fn 读失败时系统自启一次都不动也不写文件() {
        // 这条守的是 set_autostart_enabled 的那个 `?`。把它换成 unwrap_or_default() 时必须红——
        // 否则杀软/OneDrive 短暂独占文件的那一瞬会被当成「用户没配过任何东西」，
        // 一次保存就把「关掉的自启」重新打开、且全程返回 Ok、零提示。
        // 系统调用用计数器闭包证明它没被调用——这正是本函数被抽出来要堵的形状。
        let mut system_calls = 0;
        let mut saved = false;
        let result = apply_autostart(
            true,
            || Err("读取配置文件 X 失败".to_owned()),
            |_| {
                system_calls += 1;
                Ok(())
            },
            |_| {
                saved = true;
                Ok(())
            },
        );
        assert_eq!(system_calls, 0, "读失败时系统自启一次都不许动");
        assert!(!saved, "读失败时一个字都不许写");
        assert!(result.is_err());
    }

    #[test]
    fn 系统调用失败时不写文件错误往上抛() {
        // 系统自启没开成，意图就不许落盘——文件里记的与系统实际的必须一致，
        // 否则下次启动会照着错的意图去修系统状态。错误要原样往上抛，不能吞。
        let mut saved = false;
        let result = apply_autostart(
            true,
            || Ok(DesktopConfig::default()),
            |_| Err("enable 被系统拒绝".to_owned()),
            |_| {
                saved = true;
                Ok(())
            },
        );
        assert!(!saved, "系统调用失败时不许落盘");
        assert_eq!(result.unwrap_err(), "enable 被系统拒绝");
    }

    #[test]
    fn 落盘失败时错误信息说明矛盾态() {
        // 系统自启成功、意图落盘失败 = 「系统已变、记录没跟上」的矛盾态，
        // 错误信息必须把两半都讲清楚，设置页原样展示即可让用户知道现状。
        let err = apply_autostart(
            true,
            || Ok(DesktopConfig::default()),
            |_| Ok(()),
            |_| Err("替换配置文件 X 失败".to_owned()),
        )
        .unwrap_err();
        assert!(err.contains("自启已开启"), "错误要说明系统侧实际已开：{err}");
        assert!(err.contains("关闭意图记录失败"), "错误要说明是意图落盘失败：{err}");
        assert!(err.contains("替换配置文件 X 失败"), "落盘的原始错误不能丢：{err}");

        let err = apply_autostart(
            false,
            || Ok(DesktopConfig::default()),
            |_| Ok(()),
            |_| Err("替换配置文件 Y 失败".to_owned()),
        )
        .unwrap_err();
        assert!(err.contains("自启已关闭"), "关闭侧也要说明系统侧实际已关：{err}");
        assert!(err.contains("意图记录失败"), "关闭侧的矛盾态措辞：{err}");
        assert!(err.contains("替换配置文件 Y 失败"), "关闭侧的原始错误不能丢：{err}");
    }

    #[test]
    fn 成功路径按意图开关系统并把意图落盘() {
        // 正常路径的两半都要对：传给系统调用的方向与 enabled 一致，落盘的
        // autostart_disabled 是 enabled 的反（自启开启 = 没有禁用意图）。
        let mut system_on: Option<bool> = None;
        let mut written: Option<DesktopConfig> = None;
        apply_autostart(
            true,
            || Ok(DesktopConfig::default()),
            |on| {
                system_on = Some(on);
                Ok(())
            },
            |cfg| {
                written = Some(cfg.clone());
                Ok(())
            },
        )
        .expect("开自启应成功");
        assert_eq!(system_on, Some(true));
        assert!(!written.expect("必须落盘").autostart_disabled);

        let mut system_on: Option<bool> = None;
        let mut written: Option<DesktopConfig> = None;
        apply_autostart(
            false,
            || Ok(DesktopConfig::default()),
            |on| {
                system_on = Some(on);
                Ok(())
            },
            |cfg| {
                written = Some(cfg.clone());
                Ok(())
            },
        )
        .expect("关自启应成功");
        assert_eq!(system_on, Some(false));
        assert!(written.expect("必须落盘").autostart_disabled);
    }
}
