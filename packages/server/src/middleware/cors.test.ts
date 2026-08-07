import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_REQUEST_HEADERS,
  CORS_PREFLIGHT_MAX_AGE_SECONDS,
  SHELL_ORIGINS,
  SHELL_ORIGINS_BY_SHELL,
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

// 2026-08-07 生产事故闸：桌面版(Tauri)是继 Android/iOS 之后的第三个壳，它的 origin
// `http://tauri.localhost` 从没进过 .env.example / deployment.md / 生产 ALLOWED_ORIGINS，
// 于是桌面版的每个 /api/* 都被 CORS 拒，报「网络请求失败：无法连接 …/api/sync/push」。
// 同一个坑安卓(https://localhost)与 iOS(capacitor://localhost)当年各踩过一次——壳的 origin
// 由壳运行时写死、自托管者无从得知，靠文档提醒挡不住，所以改成代码内置 + 下面两条机检。
describe("壳 origin 内置放行", () => {
  const NON_SHELL_ORIGIN = "https://timedata.example.com";

  function preflight(allowedOrigins: string[], origin: string) {
    const app = new Hono();
    app.use("/api/*", cors(corsOptions(allowedOrigins)));
    app.post("/api/sync/push", (c) => c.json({ ok: true }));
    return app.request("/api/sync/push", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
      },
    });
  }

  it("每个壳 origin 在 ALLOWED_ORIGINS 为空时也放行", async () => {
    expect(SHELL_ORIGINS.length).toBeGreaterThan(0); // 清单空了别让闸静默变绿

    for (const origin of SHELL_ORIGINS) {
      const res = await preflight([], origin);
      expect(res.headers.get("Access-Control-Allow-Origin"), origin).toBe(origin);
    }
  });

  // 事故的直接内容，硬编码防以后有人顺手删掉某一种形态：
  // Tauri 2 的 origin 见 tauri-2.11.5/src/manager/mod.rs 的 tauri_protocol_url()。
  it("Tauri 三种形态都在内置清单里（Windows 的 http、开 https scheme 的 https、macOS/Linux 的自定义 scheme）", () => {
    expect(SHELL_ORIGINS).toContain("http://tauri.localhost");
    expect(SHELL_ORIGINS).toContain("https://tauri.localhost");
    expect(SHELL_ORIGINS).toContain("tauri://localhost");
  });

  it("内置清单没有顺带放宽普通域名：非壳 origin 仍必须在 ALLOWED_ORIGINS 里（闸自身不空转）", async () => {
    const denied = await preflight([], NON_SHELL_ORIGIN);
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const allowed = await preflight([NON_SHELL_ORIGIN], NON_SHELL_ORIGIN);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(NON_SHELL_ORIGIN);
  });
});

// 上面那条只保证「清单里的 origin 会放行」，挡不住「又加了一个壳但忘了加它的 origin」——
// 而这正是这次事故的形状（desktop 包早就有了，CORS 这一环从没跟上）。所以要求 packages/ 下
// 每个包都在下面表态是不是壳：新增任何包都会让这条闸红，逼作者回答「这个包是不是又一个壳」。
describe("壳包登记闸", () => {
  /** packages/ 下每个包 → 壳类型；不是壳的写 null。新增包必须在这里登记。 */
  const PACKAGE_SHELL: Record<string, keyof typeof SHELL_ORIGINS_BY_SHELL | null> = {
    cli: null,
    client: null,
    server: null,
    shared: null,
    desktop: "tauri",
    mobile: "capacitor",
  };

  const PACKAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

  function packageNames(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
      .map((entry) => entry.name)
      .sort();
  }

  function unregistered(actual: string[], registered: Record<string, unknown>): string[] {
    return actual.filter((name) => !(name in registered));
  }

  it("packages/ 下的每个包都已登记（新增包不登记就红）", () => {
    const actual = packageNames(PACKAGES_DIR);
    expect(actual.length).toBeGreaterThan(0); // 扫不到就是路径错了，别让闸静默变绿

    expect(unregistered(actual, PACKAGE_SHELL)).toEqual([]);
    // 反向也要对：删了包却留着登记，说明这张表已经不反映现实
    expect(Object.keys(PACKAGE_SHELL).filter((name) => !actual.includes(name))).toEqual([]);
  });

  it("两个方向的漂移都确实会被检出（闸自身不空转）", () => {
    // 新增了包但没登记
    expect(unregistered(["desktop", "watch-shell"], PACKAGE_SHELL)).toEqual(["watch-shell"]);
    // 登记了已不存在的包
    expect(Object.keys({ desktop: "tauri", gone: null }).filter((name) => !["desktop"].includes(name))).toEqual([
      "gone",
    ]);
  });

  it("每个登记为壳的包都有 origin，且都在放行清单里", () => {
    const shellKinds = Object.values(PACKAGE_SHELL).filter((kind): kind is NonNullable<typeof kind> => kind !== null);
    expect(shellKinds.length).toBeGreaterThan(0);

    for (const kind of shellKinds) {
      const origins = SHELL_ORIGINS_BY_SHELL[kind];
      expect(origins, kind).toBeDefined();
      expect(origins.length, kind).toBeGreaterThan(0);
      for (const origin of origins) {
        expect(SHELL_ORIGINS, `${kind}: ${origin}`).toContain(origin);
      }
    }
  });
});
