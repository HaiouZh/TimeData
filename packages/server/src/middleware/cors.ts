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

export function allowedOriginsFromEnv(env: Record<string, string | undefined>): string[] {
  const origins = env.ALLOWED_ORIGINS;
  if (origins === undefined) return [];
  return origins
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
