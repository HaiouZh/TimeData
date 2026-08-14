# 0032 桌面自动更新走 tauri-plugin-updater，更新源托管在 GitHub 固定 tag

## 状态

已采纳（2026-08-14）。补充 [ADR 0029](0029-desktop-shell-embeds-frontend.md)——它定了「桌面壳内嵌前端产物、不走网页那套自更新链」，本 ADR 定的是这个壳自己怎么更新。

## 背景

桌面壳此前只能手动更新：去 GitHub 找包、下载、双击。这条路上有一个会丢数据的坑。

手动安装新版必然撞 NSIS 的「已安装」页，**默认选中「先卸载再装」**，那条路会露出一个「删除应用数据」复选框。勾了就 `RmDir /r` 掉两个目录：`$LOCALAPPDATA\icu.yanzhou.timedata`（本机 IndexedDB 的**全部记录**）与 `$APPDATA` 下同名目录（`desktop-config.json` 的热键配置，不参与同步，删了是真丢）。

桌面壳是本机上又一份独立的 IndexedDB（见 [ADR 0029](0029-desktop-shell-embeds-frontend.md) 与 desktop 主题文档 §6），未同步的记录只此一份。也就是说：**一次装新版的手滑，可以清空这台机器上的全部本地记录。**

临时规避是「改选第二项『不卸载』覆盖装」——依赖用户每次都选对，不是解法。

## 核实

**`/UPDATE` + `passive` 构成两道独立的锁，走 updater 时删数据结构上不可能发生。**

`tauri-bundler` 的 `nsis/installer.nsi` 里删数据的条件是两个 AND：`$DeleteAppDataCheckboxState = 1` **且** `$UpdateMode <> 1`。而 updater 唤起安装器时无条件推 `/UPDATE`（`plugins-workspace/plugins/updater/src/updater.rs` 中 `installer_args.push(OsStr::new("/UPDATE"))` 不在任何分支内），`/UPDATE` 使 `$UpdateMode = 1`，第二个条件恒假——**即使复选框状态为真也删不掉**。第二道锁是 `passive` 模式下 `un.SkipIfPassive` 直接 `Abort` 掉卸载确认页，复选框根本不渲染。两道锁独立生效，缺一仍安全。

**自建托管比 GitHub 慢一个数量级，且要新增基础设施。**

2026-08-14 在用户本机实测同一个 9.4MB 安装包：GitHub Release 1.5 MB/s（6 秒），自建服务器 `timedata.yanzhou.icu` 130 KB/s（72 秒）。后者是阿里云海外小带宽实例，且与同步争抢同一条链路。此外服务端 `public/` 是构建进 Docker 镜像的（见 deployment 主题），托管安装包要新增持久卷、静态路径与一条 CI→服务器的传输通道与鉴权。

**GitHub 的「Latest」标记在本仓不可用于桌面版。**

该标记是带 APK 的 Release 专属（windows job 刻意不执行 `gh release edit --latest`，见 desktop 主题 §9）。因此业界常用的 `releases/latest/download/latest.json` 会指向错误版本、甚至指向根本不含 Windows 包的 Release。

**签名不可关闭。** `tauri-plugin-updater` 的 `pubkey` 是必填（`config.rs` 中 `pub pubkey: String`，非 `Option`、无 default），配置里不存在跳过验签的开关。

## 决策

1. **接 `tauri-plugin-updater`**，不自建更新逻辑。数据安全由上述两道锁保证，而非由用户在安装向导里选对选项。
2. **更新源托管在 GitHub Release 的固定 tag `desktop-latest`**，只放 `latest.json`、每次 `--clobber` 覆盖；安装包本体仍在各自的 `v<code>` Release 里由 `url` 指过去。不用 `releases/latest/`，不自建托管。
3. **静默下载 + 手点安装**：后台自动检查并下好，安装必须由用户在设置页点。不做全自动装（常驻壳被强制重启的代价高于收益），也不做纯手动检查（那不解决「忘记更新」）。
4. **不做主动提示**：唯一入口是设置页那一行，不加托盘菜单项、不加图标角标。接受「不看设置页就不知道有新版」这个后果——按当前日更节奏，任何时候点一次都直达最新版。
5. **更新逻辑全在 Rust 侧**，前端不引入任何 `@tauri-apps/plugin-*`。除与既有惯例一致外，还有硬约束：`download()` 返回的内存缓冲与 `Update` 句柄要跨「下载完」到「用户点」这段时间存活，前端存不住。
6. **不做 Windows 代码签名证书**，维持 SmartScreen 首装拦一次的现状。要花钱且要企业资质，与单人自托管定位不符。这与第 1 条的更新包签名是两回事——后者是免费的 minisign 密钥对，且不可关闭。

## 后果

**私钥丢失不可恢复。** 已装机的客户端只认写死在 `tauri.conf.json` 里的公钥，换钥匙等于全部老版本永久失去更新能力、只能逐台手动重装。而 GitHub Secret 只能覆盖、不能读出，因此它不构成一份可取回的备份——本机私钥文件必须另有异地副本。

**安装必然可感知。** Windows 安装器限制，`install()` 后进程立即退出、由安装器重新拉起，不存在无感的原地升级。重启本身是安全的：草稿在 localStorage、记录在 IndexedDB、同步幂等可续。

**下载缓冲随进程走。** 应用一重启「已下好」即失效、需重下。不做磁盘缓存。

**存量装机版本不含 updater**，必须手动装一次带 updater 的版本才能接上这条链路，而那一次仍要人工避开「先卸载再装」。这是最后一次需要人工规避。

**多一个常驻的 Release 条目**（`desktop-latest`，标为 prerelease）。它由 CI 自动维护，不可手动编辑或删除。

## 相关

- 机制与契约的正本：desktop 主题子文档 [auto-update](../evergreen/desktop/auto-update.md)
- [ADR 0029](0029-desktop-shell-embeds-frontend.md)：桌面壳内嵌前端产物，网页那套自更新链不进常驻壳
