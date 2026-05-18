import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFileConfig, resolveConfig } from "./config.js";

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("resolveConfig", () => {
  it("prefers flags over environment and file config", () => {
    const config = resolveConfig(
      { server: "https://flag.example", token: "flag-token" },
      { TIMEDATA_SERVER_URL: "https://env.example", TIMEDATA_TOKEN: "env-token" },
      { serverUrl: "https://file.example", token: "file-token" },
    );

    expect(config).toEqual({ serverUrl: "https://flag.example", token: "flag-token" });
  });

  it("uses environment before file config", () => {
    const config = resolveConfig(
      {},
      { TIMEDATA_SERVER_URL: "https://env.example", TIMEDATA_TOKEN: "env-token" },
      { serverUrl: "https://file.example", token: "file-token" },
    );

    expect(config).toEqual({ serverUrl: "https://env.example", token: "env-token" });
  });

  it("reports invalid config JSON without throwing", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-cli-config-"));
    const configPath = path.join(tempDir, "config.json");
    fs.writeFileSync(configPath, "{not-json", "utf8");

    expect(readFileConfig(configPath, "win32")).toEqual({
      ok: false,
      error: { code: "CONFIG_INVALID", message: `Invalid config file: ${configPath}` },
    });
  });

  it("rejects world-readable config files on unix", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-cli-config-"));
    const configPath = path.join(tempDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ serverUrl: "https://server.example" }), "utf8");
    fs.chmodSync(configPath, 0o644);

    expect(readFileConfig(configPath, "linux")).toEqual({
      ok: false,
      error: {
        code: "CONFIG_INVALID",
        message: `Config file permissions are too open: ${configPath}`,
      },
    });
  });
});
