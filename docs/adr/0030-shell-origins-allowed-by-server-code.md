# 0030 壳的 CORS origin 由服务端代码内置放行，不再要求部署者手填

## 状态

已采纳（2026-08-07）

## 背景

TimeData 有三个内嵌前端的壳（Android、iOS、Windows 桌面），它们的 WebView 都从本地协议加载页面，因此访问服务端一律是**跨域**，要过 `/api/*` 的 CORS 白名单。而每个壳的 origin 是壳运行时写死的常量，部署者既改不了也无从得知：

| 壳 | origin |
|---|---|
| Capacitor Android（`androidScheme: "https"`） | `https://localhost` |
| Capacitor iOS（默认 scheme） | `capacitor://localhost` |
| Tauri v2 Windows / Android | `http://tauri.localhost`（配了 https scheme 则 `https://`） |
| Tauri v2 macOS / Linux | `tauri://localhost` |

原先这些 origin 是 `ALLOWED_ORIGINS` 的**必配项**，靠 `.env.example`、部署文档和设置页提示来传达。三个壳因此各踩过一次同一个坑：漏配 → 壳内每个 `/api/*` 被 CORS 拒 → 客户端只能报「网络请求失败：无法连接 …」，而同源的网页版毫无异常，于是排查方向天然被带偏到网络与证书上。

最近一次是 2026-08-07：桌面壳（[0029](0029-desktop-shell-embeds-frontend.md)）上线后，`http://tauri.localhost` 从没进过任何一份示例、文档或生产白名单，桌面版的同步与 SSE 全线被拒。

共同点是：**漏配的信息部署者本来就拿不到**，而漏配的代价（整个平台失联）与它的隐蔽度严重不匹配。文档已经写过「必配」并且没挡住，第三次了。

## 决策

**壳的 origin 改由服务端代码内置放行**：`packages/server/src/middleware/cors.ts` 的 `SHELL_ORIGINS_BY_SHELL` 按壳列出上表所有 origin，`corsOptions()` 在查 `ALLOWED_ORIGINS` 之前先放行它们。`ALLOWED_ORIGINS` 从此只用来填**网页域名**。

Tauri 的三种形态（Windows 的 `http`、开 https scheme 的 `https`、macOS/Linux 的自定义 scheme）一次全列，换平台或换 scheme 都不必再动服务端。

两条机检守它（`cors.test.ts`）：

- 每个 `SHELL_ORIGINS` 成员在 `ALLOWED_ORIGINS` 为空时也放行，且非壳 origin 仍必须在白名单里（内置放行没有顺带放宽普通域名）。
- `packages/` 下每个包都要登记是不是壳；**新增任何包都会让这条闸红**，逼作者回答「这个包是不是又一个壳」——正对准这次事故的形状（`desktop` 包早就有了，CORS 这一环从没跟上）。

## 后果

- 自托管者装任何一个壳都零配置可用；`.env.example` 里 `ALLOWED_ORIGINS` 只剩网页域名一项。
- **安全性不放松**。CORS 约束的是浏览器里的第三方网页，防的是「用户在恶意站点上，该站点的脚本借用户凭证打你的 API」。而 `tauri.localhost` / `localhost` 这些 origin 只有本机安装的壳才能占据，一个真正的恶意本地应用根本不受 CORS 约束（直接发 HTTP 请求即可），放行它们没有给出任何原本拿不到的能力。守 API 的是 Bearer token（[0011](0011-server-api-as-write-boundary.md)），CORS 从来不是。
- 代价：服务端多背一份「客户端壳有哪些」的知识，新增壳时要同步 `SHELL_ORIGINS_BY_SHELL`。这正是上面第二条机检要挡的，也比让每个部署者各自摸索便宜。
- 旧版本服务端仍需手填，所以客户端文案与设置页提示保留「服务端版本较早时把 origin 填进 `ALLOWED_ORIGINS`」这一句。

机制现状见 [deployment/configuration](../evergreen/deployment/configuration.md) §1。
