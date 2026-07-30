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
      return allowedOrigins.includes(origin) ? origin : null;
    },
    allowHeaders: [...ALLOWED_REQUEST_HEADERS],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: CORS_PREFLIGHT_MAX_AGE_SECONDS,
  };
}
