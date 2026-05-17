import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface FileConfig {
  serverUrl?: string;
  token?: string;
}

export type ConfigError = { ok: false; error: { code: "CONFIG_MISSING" | "CONFIG_INVALID"; message: string } };

export type FileConfigResult = FileConfig | ConfigError | null;

export type ConfigResult =
  | { serverUrl: string; token: string }
  | ConfigError;

export function configPath(platform = process.platform, env = process.env): string {
  if (platform === "win32") {
    return path.join(env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "timedata", "config.json");
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "timedata", "config.json");
}

function hasUnsafePermissions(filePath: string, platform = process.platform): boolean {
  if (platform === "win32") return false;
  const mode = fs.statSync(filePath).mode & 0o777;
  return (mode & 0o077) !== 0;
}

export function readFileConfig(filePath = configPath(), platform = process.platform): FileConfigResult {
  if (!fs.existsSync(filePath)) return null;
  if (hasUnsafePermissions(filePath, platform)) {
    return { ok: false, error: { code: "CONFIG_INVALID", message: `Config file permissions are too open: ${filePath}` } };
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as FileConfig;
  } catch {
    return { ok: false, error: { code: "CONFIG_INVALID", message: `Invalid config file: ${filePath}` } };
  }
}

export function resolveConfig(
  flags: Record<string, string | undefined>,
  env: Record<string, string | undefined>,
  fileConfig: FileConfigResult,
): ConfigResult {
  if (fileConfig && "ok" in fileConfig) return fileConfig;

  const serverUrl = flags.server || env.TIMEDATA_SERVER_URL || fileConfig?.serverUrl || "";
  const token = flags.token || env.TIMEDATA_TOKEN || fileConfig?.token || "";

  if (!serverUrl) {
    return { ok: false, error: { code: "CONFIG_MISSING", message: "Missing TimeData server URL" } };
  }

  return { serverUrl, token };
}
