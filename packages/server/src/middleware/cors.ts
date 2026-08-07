import type { cors } from "hono/cors";

// 跨域预检放行的请求头白名单。客户端 apiFetch 设置的任何自定义头都必须列在这里，
// 否则 Capacitor 壳(origin https://localhost)的每个请求都会预检失败——而同源网页版
// 不走预检、毫无感知。`cors.test.ts` 有一条跨包闸机检这个一致性。
export const ALLOWED_REQUEST_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Confirm",
  "X-TimeData-Client",
  "X-TimeData-Client-Build",
  "X-TOTP-Code",
] as const;

// 预检结果的缓存时长（秒）。不发这个头时浏览器只缓存 5 秒(Chromium 默认)，
// 而 Capacitor 壳每个请求都跨域且带 Authorization = 非简单请求，必须预检——
// 于是安卓的每次 API 调用实际是两个整往返。移动网络上这笔翻倍很贵：
// 2026-07-30 生产取证，一次冷启动里客户端测得 status 阶段 5311ms，服务端只花了 5ms。
// 同源网页版不走预检，所以这个坑在电脑上永远复现不出来。
export const CORS_PREFLIGHT_MAX_AGE_SECONDS = 86_400;

// 应用壳（Capacitor / Tauri）里 WebView 的固定 origin，按壳分组。
// 这些值由壳的运行时写死、部署者无从得知也改不了，所以内置放行、不再要求手填 ALLOWED_ORIGINS：
// 2026-08-07 生产事故——桌面版(Tauri)的 http://tauri.localhost 从没进过任何一份示例或白名单，
// 桌面版每个 /api/* 都被 CORS 拒；安卓与 iOS 当年各踩过一次同样的漏配。
// 安全上不放松：CORS 只约束浏览器里的第三方网页，一个真正的恶意本地应用根本不受 CORS 限制，
// 真正的门是 Bearer token。`cors.test.ts` 有两条闸，其一要求 packages/ 下每个新包都表态是不是壳。
export const SHELL_ORIGINS_BY_SHELL = {
  /** Capacitor（packages/mobile）：Android 配 androidScheme:"https"，iOS 走 Capacitor 默认 scheme。 */
  capacitor: ["https://localhost", "capacitor://localhost"],
  /**
   * Tauri v2（packages/desktop）。见 tauri-2.11.5/src/manager/mod.rs 的 `tauri_protocol_url()`：
   * Windows 与 Android 用 wry 的变通 URL `http(s)://tauri.localhost`（http 是默认，配了 https scheme 才是 https），
   * macOS / Linux 用自定义 scheme `tauri://localhost`。三种都放行，换平台或换 scheme 都不必再改服务端。
   */
  tauri: ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"],
} as const satisfies Record<string, readonly string[]>;

export const SHELL_ORIGINS: readonly string[] = Object.values(SHELL_ORIGINS_BY_SHELL).flat();

export function allowedOriginsFromEnv(env: Record<string, string | undefined>): string[] {
  const origins = env.ALLOWED_ORIGINS;
  if (origins === undefined) return [];
  return origins
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/** /api/* 的 CORS 配置。提炼成函数是为了让预检行为可被测试直接驱动。 */
export function corsOptions(allowedOrigins: string[]): Parameters<typeof cors>[0] {
  return {
    origin: (origin) => {
      if (!origin) {
        return null;
      }
      if (allowedOrigins.includes("*")) {
        return origin;
      }
      if (SHELL_ORIGINS.includes(origin)) {
        return origin;
      }
      return allowedOrigins.includes(origin) ? origin : null;
    },
    allowHeaders: [...ALLOWED_REQUEST_HEADERS],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: CORS_PREFLIGHT_MAX_AGE_SECONDS,
  };
}
