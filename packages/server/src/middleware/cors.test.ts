import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_REQUEST_HEADERS,
  CORS_PREFLIGHT_MAX_AGE_SECONDS,
  allowedOriginsFromEnv,
  corsOptions,
} from "./cors.js";

describe("allowedOriginsFromEnv", () => {
  it("defaults to empty array when ALLOWED_ORIGINS is not set", () => {
    expect(allowedOriginsFromEnv({})).toEqual([]);
  });

  it('returns ["*"] when ALLOWED_ORIGINS is set to "*"', () => {
    expect(allowedOriginsFromEnv({ ALLOWED_ORIGINS: "*" })).toEqual(["*"]);
  });

  it("parses comma-separated origins and trims whitespace", () => {
    expect(
      allowedOriginsFromEnv({
        ALLOWED_ORIGINS: " https://app.example.com,capacitor://localhost , http://localhost:5174 ",
      }),
    ).toEqual(["https://app.example.com", "capacitor://localhost", "http://localhost:5174"]);
  });

  it("filters empty entries", () => {
    expect(
      allowedOriginsFromEnv({
        ALLOWED_ORIGINS: "https://app.example.com,, ,capacitor://localhost,",
      }),
    ).toEqual(["https://app.example.com", "capacitor://localhost"]);
  });
});

// 2026-07-28 事故闸：client 加了 X-TimeData-Client-Build 观测头但没同步这里，
// 安卓壳(跨域)全线预检失败=「无法连接服务器」，同源网页版正常所以没人发现。
// 文档里早写了「新增跨域自定义 header 必须同步 server CORS」，光靠文档没挡住，改成机检。
describe("CORS 放行头覆盖客户端实际发送的自定义头", () => {
  const CLIENT_API_SOURCE = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "client",
    "src",
    "lib",
    "api.ts",
  );

  function customHeadersSetByClient(source: string): string[] {
    return [...source.matchAll(/headers\.set\(\s*["'](X-[\w-]+)["']/gi)].map((match) => match[1]);
  }

  it("正则确实能从 headers.set 调用里抽出自定义头（闸自身不空转）", () => {
    expect(customHeadersSetByClient('headers.set("X-Demo-Header", value);')).toEqual(["X-Demo-Header"]);
  });

  it("client/src/lib/api.ts 设置的每个 X- 头都在放行白名单里", () => {
    const sent = customHeadersSetByClient(readFileSync(CLIENT_API_SOURCE, "utf8"));
    expect(sent.length).toBeGreaterThan(0); // 抽不到就是正则失效，别让闸静默变绿

    const allowed = ALLOWED_REQUEST_HEADERS.map((header) => header.toLowerCase());
    const missing = sent.filter((header) => !allowed.includes(header.toLowerCase()));
    expect(missing).toEqual([]);
  });
});

// 2026-07-30 生产取证：安卓壳(origin https://localhost)跨域 + 每请求带 Authorization
// = 非简单请求，每次都要 OPTIONS 预检。不发 Access-Control-Max-Age 时 WebView 只缓存 5 秒，
// 冷启动期间每个 API 请求都多一个整往返（客户端实测 status 阶段 5311ms，服务端只用 5ms）。
describe("CORS 预检缓存", () => {
  function preflight(options: Parameters<typeof cors>[0]) {
    const app = new Hono();
    app.use("/api/*", cors(options));
    app.post("/api/sync/status", (c) => c.json({ ok: true }));
    return app.request("/api/sync/status", {
      method: "OPTIONS",
      headers: {
        Origin: "https://localhost",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,x-timedata-client",
      },
    });
  }

  it("预检响应带 Access-Control-Max-Age，安卓壳不必每个请求都重新预检", async () => {
    const res = await preflight(corsOptions(["https://localhost"]));

    expect(res.headers.get("Access-Control-Max-Age")).toBe(String(CORS_PREFLIGHT_MAX_AGE_SECONDS));
    expect(CORS_PREFLIGHT_MAX_AGE_SECONDS).toBeGreaterThanOrEqual(3600);
  });

  it("缺 maxAge 时这条闸确实会红（闸自身不空转）", async () => {
    const withoutMaxAge = { ...corsOptions(["https://localhost"]), maxAge: undefined };

    const res = await preflight(withoutMaxAge);

    expect(res.headers.get("Access-Control-Max-Age")).toBeNull();
  });

  it("corsOptions 仍然只放行白名单 origin", async () => {
    const options = corsOptions(["https://localhost"]);
    const allowed = await preflight(options);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://localhost");

    const app = new Hono();
    app.use("/api/*", cors(options));
    app.post("/api/sync/status", (c) => c.json({ ok: true }));
    const denied = await app.request("/api/sync/status", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example.com", "Access-Control-Request-Method": "POST" },
    });
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  // 提炼出 corsOptions 却忘了在 index.ts 接线，上面的闸照样全绿而生产没修好。
  it("index.ts 用的是 corsOptions，没有内联另一份 cors 配置", () => {
    const indexSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts"),
      "utf8",
    );

    expect(indexSource).toContain("cors(corsOptions(allowedOrigins))");
  });
});
