import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALLOWED_REQUEST_HEADERS, allowedOriginsFromEnv } from "./cors.js";

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
