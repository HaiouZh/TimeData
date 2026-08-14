---
type: evergreen
title: Windows 桌面壳 · 自动更新
covers:
  - scripts/updater-manifest.mjs
contracts:
  - packages/desktop/src-tauri/src/updater.rs
  - scripts/updater-manifest.mjs
  - packages/desktop/scripts/check-desktop-config.mjs
last-reviewed: 2026-08-14
---

# Windows 桌面壳 · 自动更新

> [desktop](../desktop.md) 的**自动更新子文档**：更新为何删不掉本机数据、签名与更新源、客户端的查/下/装三段、设置页落点、四条已知界限与配置闸。
> 讲什么：`/UPDATE` + `passive` 双保险、minisign 签名链、`latest.json` 的固定 tag 托管、状态机与节流、`updater_*` 三个命令。
> 不讲什么：壳的构成与窗口/托盘语义、开机自启、速记浮窗、NSIS 构建与三平台发布（都在 [母文档](../desktop.md)）；全局热键见 [hotkeys](hotkeys.md)。

## 承上启下

- **上游**：[母文档](../desktop.md) §9 的 NSIS 构建与 `v<code>` Release、`scripts/desktop-version.mjs` 的版本码转换、GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`。
- **下游**：用户机器上的 `%LOCALAPPDATA%\TimeData` 安装目录；`desktop-latest` 这个固定 tag 的 Release。
- **契约**：更新包必须由对应私钥签名，公钥写死在 `tauri.conf.json`；`latest.json` 的三个字段（`version` / `url` / `signature`）任一为空即拒绝产出；客户端只问 `desktop-latest` 这一个地址。
- **邻居**：[hotkeys](hotkeys.md)（同主题子文档）、[deployment](../deployment.md)（服务端自更新是另一套东西，与本文无关）。

## 1. 更新为什么删不掉本机数据

这是接入 updater 的首要动因。**手动**安装新版必然撞 NSIS 的「已安装」页，默认选中「先卸载再装」，那条路会露出「删除应用数据」复选框——勾了就 `RmDir /r` 掉 `$LOCALAPPDATA\icu.yanzhou.timedata`（本机 IndexedDB 的全部记录）与 `$APPDATA` 下同名目录（`desktop-config.json` 的热键配置，不参与同步，删了是真丢）。

走 updater 则**结构上不可能**发生，两道独立的锁：

**第一道：`/UPDATE` 参数。** `tauri-bundler` 的 `nsis/installer.nsi` 里，删数据的条件是两个 AND：

```nsis
${If} $DeleteAppDataCheckboxState = 1
${AndIf} $UpdateMode <> 1
  RmDir /r "$APPDATA\${BUNDLEID}"
  RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
${EndIf}
```

而 updater 唤起安装器时**无条件**推 `/UPDATE`（`plugins-workspace/plugins/updater/src/updater.rs`：`installer_args.push(OsStr::new("/UPDATE"));`）。`/UPDATE` 使 `$UpdateMode = 1`，第二个条件恒假——**即使复选框状态为真也删不掉**。

**第二道：`passive` 模式。** `installMode` 配为 `passive` 时，NSIS 的卸载确认页被 `Abort` 跳过，那个复选框根本不渲染：

```nsis
Function un.SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd
```

两道锁独立生效，缺一仍安全。`installMode` 因此**显式写在配置里而非依赖默认值**，并由配置闸守着（§6）。

## 2. 签名与更新源

### 2.1 签名

`tauri-plugin-updater` 的 `pubkey` 是**必填**（`config.rs` 里 `pub pubkey: String`，非 `Option`、无 default），且**不存在关闭验签的开关**——配置里那几个 `dangerous_*` 全是传输层的。这是设计使然：自动更新是一条远程代码执行通道，验签是它唯一的把关。

| 位置 | 内容 | 进 Git |
|---|---|---|
| `tauri.conf.json` 的 `plugins.updater.pubkey` | minisign 公钥 | 是 |
| GitHub Secret `TAURI_SIGNING_PRIVATE_KEY` | 私钥全文 | 否 |
| 本机 `~/.tauri/timedata-updater.key` | 同上 | 否 |

私钥使用**空密码短语**，workflow 里 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 直接写空串，不设第二个 Secret。

**私钥丢失不可恢复**：已装机的客户端只认对应公钥，换钥匙等于全部老版本永久失去更新能力、只能逐台手动重装。而 GitHub Secret **只能覆盖、不能读出**，因此它不构成一份可取回的备份。

### 2.2 更新源固定在 `desktop-latest`

客户端只问一个地址：

```
https://github.com/HaiouZh/TimeData/releases/download/desktop-latest/latest.json
```

`desktop-latest` 是一个**固定 tag 的 prerelease Release**，只放 `latest.json`，每次发版 `--clobber` 覆盖；安装包本体仍躺在各自的 `v<code>` Release 里，由 json 的 `url` 指过去。

**这个 Release 是人工一次性创建的**，CI 从不创建它：

```
gh release create desktop-latest --prerelease --title "桌面版更新源"
```

CI 的发布步骤只往它上面 `--clobber` 覆盖 `latest.json` 这一个 asset——workflow 里没有、也不该有 `gh release create`。[ADR 0032](../../adr/0032-desktop-auto-update-via-github-release.md) 说的「由 CI 自动维护」指的是 `latest.json` 的**内容**，不是 Release 条目本身。

**它被误删后必须人工重建**（同样的命令），否则每次发版都会在发布 `latest.json` 那一步硬失败，且全部已装机客户端持续拿到 404、静默停在旧版。

**不能改用 `releases/latest/download/`**：GitHub 的「Latest」标记在本仓是**带 APK 的 Release 专属**（母文档 §9：windows job 刻意不碰 latest），那条路会指向错误版本、甚至指向根本不含 Windows 包的 Release。

### 2.3 `latest.json` 由带单测的脚本产出

`scripts/updater-manifest.mjs` 的 `buildUpdaterManifest()` 拼 json 并在字段有问题时**抛错而非产出**。校验五条：`version` 是 semver、`tag` 与 `repo` 非空、`signature` 非空白、`pub_date` 是 RFC3339 UTC。

其中 `signature` 那条是本脚本存在的首要理由：`.sig` 读空会产出一份**看着完全正常**的 json，而验签失败要等到用户点更新那一刻才暴露。CI 里 inline 拼 json 无法被测试锁住这一条，故独立成脚本，测试在 `scripts/updater-manifest.test.mjs`，随 `pnpm test:scripts` 跑。

版本号取 `scripts/desktop-version.mjs` 的 `codeToSemver` 输出（`26081402` → `26.814.2`），与注入构建的版本同源。该转换三级单调递增（跨月 `26.814.2` < `26.901.1`、跨年 `26.1231.1` < `27.101.1`），满足 updater 的 semver 比对。

`notes` 恒为空串：本仓 Release body 无人工撰写的更新说明。

## 3. 客户端：查、下、装

逻辑全在 Rust 侧，前端不引入任何 `@tauri-apps/plugin-*`。两条理由：与既有惯例一致（插件能力一律走 Rust 命令 + `invoke`）；以及一条硬约束——`download()` 返回的是**内存缓冲**（`Result<Vec<u8>>`），它与 `Update` 句柄要跨「下载完」到「用户点」这段时间存活，前端存不住。

### 3.1 状态与节流

`updater.rs` 的纯函数层（单测覆盖）：

| 函数 | 判定 |
|---|---|
| `resolve_phase(enabled, busy, has_ready)` | 四态串 `disabled` / `busy` / `ready` / `idle`，**`disabled` 压倒一切** |
| `should_check(last, now, interval, manual)` | 手动恒真；未查过恒真；否则 `now.saturating_sub(last) >= interval` |
| `resolve_download_decision(ready, available)` | 版本串相等则 `Skip`，否则 `Download` |

`should_check` 用**饱和减法**：系统时钟回拨时 `now < last`，裸减在 debug 会 panic、release 会环绕成巨值，后者表现为「时钟一回拨就疯狂查更新」。

`resolve_download_decision` **只比相等、不比大小**：`check()` 已保证返回的版本比当前装机版新，而 `latest.json` 被回滚时应当跟随回滚版本，不是死守手里更高的那个。

### 3.2 检查节奏

- 启动后 5 秒首查（`STARTUP_DELAY_MS`），不与启动抢资源。
- 之后每 4 小时一轮（`CHECK_INTERVAL_MS`）。**常驻壳可能数周不重启，只靠启动检查等于不查。**
- 设置页手点「检查更新」绕过节流（`manual = true`）。
- **debug 构建整条不启动**：`tauri.conf.json` 的 `version` 是占位 `0.1.0`，真版本只在 CI 用 `--config` 注入，dev 下 `check()` 会恒判「有新版」。判定取运行时短路（`cfg!(debug_assertions)`）而非模块级 `#![cfg(...)]`——前端无条件调状态命令，模块被 cfg 掉会让命令不存在、`invoke` 直接 reject。

### 3.3 三个命令与锁的形状

| 命令 | 作用 |
|---|---|
| `updater_status` | 读四态、当前版本、可用版本、上次检查时间与错误 |
| `updater_check_now` | 手动触发，绕过节流 |
| `updater_install` | 取出缓冲并安装（进程随即退出） |

`UpdaterState` 是 `Mutex<UpdaterInner>`，持有 `phase_is_busy`、`ready_version`、`pending: Option<(Update, Vec<u8>)>`、`last_checked_ms`、`last_error`。

**每次加锁都关在独立块内，`.await` 发生时不持锁**——`std::sync::Mutex` 的 guard 不是 `Send`，跨 await 持有会直接编译失败。这个形状是强制的，不是风格选择。

### 3.4 失败一律静默

网络不通、GitHub 不可达、下载中断、验签失败：一律退回空闲并记 `last_error`，不发通知、不弹窗。依据是更新失败对用户零损失——手上版本照常能用。`last_error` **保留原因文本**（区分网络 / 验签 / 解析），因为验签失败几乎必然是 CI 侧配错（典型为 `signature` 读空），与网络抖动的处置完全不同。

## 4. 设置页那一行

落点在设置页「高级与更新」分组，与 APK / 服务端 / 前端更新三行并列。四态文案由 `desktopUpdateSubtitleOf()`（`packages/client/src/lib/desktop/api.ts`，有单测）决定：

| 状态 | 副标题 | 可点 |
|---|---|---|
| `ready` | 新版 X 已下载好，点这里更新并重启 | 是（装并重启） |
| `busy` | 正在检查更新… | 否 |
| `idle` | 当前版本：X | 是（手动检查） |
| `idle` + 有错 | 当前版本：X · 上次检查失败 | 是（手动检查） |
| `disabled` | 开发构建不检查更新 | 否 |

「上次失败」仍并列显示当前版本：只显示失败会让用户不知道自己停在哪个版本上，而那恰是失败时最该知道的事。

点「更新并重启」**不做二次确认**——按钮文案已含「并重启」。重启是安全的：速记草稿存 localStorage（母文档 §5.4）、记录数据在 IndexedDB、同步幂等可续，三者都不受进程重启影响。

页面停留期间每 10 秒轮询一次状态，好让后台下完的「已就绪」不刷新页面也能显出来。

## 5. 已知界限

1. **下载缓冲随进程走**：`Vec<u8>` 与 `Update` 句柄只活在内存里，应用一重启「已下好」即失效、需重下（约 6 秒）。不做磁盘缓存——省下的几秒不值一套过期清理逻辑。
2. **无主动提示**：不打开设置页就不会知道有新版。不做托盘菜单项、不做图标角标。
3. **安装必然可感知**：Windows 安装器限制，`install()` 后进程立即退出，由安装器重新拉起。不存在无感的原地升级。退出前有 `on_before_exit` 钩子可做收尾。
4. **仅 Windows x86_64**：`latest.json` 只声明该 target。Android / iOS 各有自己的更新路径，不共用。

## 6. 配置闸守什么

`check-desktop-config.mjs` 中与本主题相关的五条（配错时构建、测试、其余断言全绿，装机后更新静默失效）：

| 断言 | 配错的后果 |
|---|---|
| `bundle.createUpdaterArtifacts === true` | bundler 不产 `.sig`，`latest.json` 的 signature 无处可取 |
| `plugins.updater.pubkey` 非空 | 验签失去唯一依据 |
| `endpoints` 恰为 `desktop-latest` 那一个 URL | 改用 `releases/latest/` 会指向 Android 的 Release |
| `windows.installMode === "passive"` | 丢掉 §1 的第二道锁 |
| 禁静态 import 的正则覆盖 `@tauri-apps/plugin-*` | 插件包被打进入口 chunk，Web / Android / iOS 加载即报错 |

最后一条是本次补上的缺口：原正则只认 `@tauri-apps/api`，插件包能穿过全部门禁。

## 7. 排错

- **设置页没有「桌面版更新」这一行**：该行在状态取回前不渲染（`desktopUpdate` 为 null）。Rust 命令不存在或 IPC 失败时会一直不显示——看是不是跑在非桌面环境，或 `updater_status` 没注册进 `invoke_handler`。
- **一直显示「当前版本」，从不出现新版**：先看是不是 dev 构建（应显示「开发构建不检查更新」）；再看 `desktop-latest` 的 `latest.json` 里的 `version` 是否真的大于当前版本（semver 比对，不是字符串比对）。
- **点了更新没反应**：`install()` 会让进程立即退出，窗口关闭即正常。若几秒后没自动重开，去开始菜单手动启动一次。
- **更新后热键配置没了**：不应发生（§1 两道锁）。真发生了说明走的不是 updater 路径——检查是不是手动双击安装包并选了「先卸载再装」+ 勾了删除数据。
- **更新后开机自启还在吗**：母文档 §3 记载的「NSIS 安装新版本时先卸载旧版本、一并清掉启动项」描述的是**手动安装**路径。`/UPDATE` 走覆盖安装、不执行卸载流程，理论上不触碰启动项，但**该路径尚未装机实测**。若更新后发现自启失效，壳下次启动会按母文档 §3 的判定自愈（用户在应用设置里显式关过的除外），不需要手动修。
- **CI 报「没找到 .sig」**：`createUpdaterArtifacts` 被关掉，或 `TAURI_SIGNING_PRIVATE_KEY` 没注入到 `Build NSIS installer` 步骤的 env。
