# 0029 Windows 桌面壳内嵌前端产物，不加载线上站点

## 状态

已采纳（2026-08-03）

## 背景

Windows 是 TimeData 的主用场景，但三个平台里只有它没有独立入口：Android 有 APK、iPhone 有侧载 IPA，Windows 只有浏览器标签页。桌面壳要解决的是「想记的那一秒」的摩擦——全局热键唤起，任何时刻一按即到。

壳怎么拿到前端，有三条互斥的路线：

- **甲**：壳加载线上站点 URL，只提供托盘与热键，本质是专用浏览器。
- **乙**：壳内打包 `client` 的构建产物，数据存本地、走同步，与 Android / iOS 壳同构。
- **丙**：壳内嵌服务端与本地 SQLite，双击即全套，不依赖远程。

三者在功能、界面、数据、同步上并无差别，唯一的本质区别是**那份前端代码从服务器拉、还是从磁盘读**（丙另外还搬动了服务端）。

丙会把同步拓扑从「多客户端对一服务端」变成「服务端对服务端」——本机一份 SQLite、云上一份 SQLite，真相源归属未定，[0012](0012-sync-ledger-and-domain-registry.md) 的账本不是为此设计的。它属于产品重选级别，须先单独解决同步拓扑。

甲的代价则藏在一处既有机制里：`AppUpdateProvider` 在 `window.focus` 事件上检查前端版本，发现服务器 buildId 变化即执行 `hardRefresh`——注销所有 service worker、清空所有 Cache Storage、再 reload，且先毁后建。这套机制在浏览器标签页里合理（人在屏幕前，白屏刷一下即可），但常驻壳被热键唤起的那一刻正好获得焦点：若服务器前端刚更新过，按下热键换来的是清缓存加整页重载，而不是输入框；重载若撞上服务端正在重启（部署瞬间最可能不可用），离线兜底也一并失去。

## 决策

**走乙：Tauri 壳内打包 `packages/client` 的 `mode=mobile` 构建产物。**

推论与随之而来的约束：

- 桌面壳吃 `mode=mobile` 产物而非默认构建。该模式不注册 service worker，上述 focus → hardRefresh 链路在壳内不成立。
- 壳选型为 Tauri（吃 Windows 自带 WebView2，Rust 侧不写业务）。Electron 的优势只在丙路线成立，丙已排除。
- 三个壳同构：Android、iOS、Windows 都是「内嵌前端 + 服务端同步」，一套心智、一套 CI 结构。
- 代价已接受：多一条发版链路，前端改动不会自动到达桌面版，须重新出包。

## 后果

- 桌面版是本机上又一份独立的 IndexedDB（Tauri 用独立的 WebView2 用户数据目录，与浏览器 profile 不互通），首次启动为空数据，靠同步汇合。此性质与路线选择无关——甲同样不与浏览器同源，该假设在决策过程中被证伪。
- 服务端不可用时，桌面版仍是完整可用的本地优先客户端，只是同步排队。这与 `AGENTS.md` 定位中的「本地优先」一致，而甲会让四个入口里唯独主场的桌面版依赖服务器可用性。
- 不涉及同步账本与写入边界的任何变更，[0011](0011-server-api-as-write-boundary.md) 与 [0012](0012-sync-ledger-and-domain-registry.md) 继续成立：桌面壳只是又一个普通同步客户端。

机制现状见 [deployment/windows-desktop](../evergreen/deployment/windows-desktop.md)。
