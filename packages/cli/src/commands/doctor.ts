import { requestJson } from "../lib/api-client.js";
import { resolveConfig, type FileConfigResult } from "../lib/config.js";

interface DoctorCheck {
  name: "config" | "serverUrl" | "server" | "auth";
  ok: boolean;
  code?: string;
  message: string;
}

function isErrorResult(value: unknown): value is { ok: false; error: { code: string; message: string } } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "ok" in value &&
      value.ok === false &&
      "error" in value &&
      value.error &&
      typeof value.error === "object" &&
      "code" in value.error &&
      "message" in value.error,
  );
}

function isHealthy(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      (("status" in value && value.status === "ok") || ("ok" in value && value.ok === true)),
  );
}

function isValidReadOnlyResponse(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  return Boolean(value && typeof value === "object" && "ok" in value && value.ok === true);
}

export async function runDoctor(
  flags: Record<string, string | undefined>,
  env: Record<string, string | undefined>,
  fileConfig: FileConfigResult,
  fetchImpl?: typeof fetch,
): Promise<unknown> {
  const checks: DoctorCheck[] = [];
  const config = resolveConfig(flags, env, fileConfig);

  if ("ok" in config) {
    return {
      ok: false,
      checks: [{ name: "config", ok: false, code: config.error.code, message: config.error.message }],
    };
  }

  checks.push({ name: "config", ok: true, message: "Configuration resolved" });

  try {
    const url = new URL(config.serverUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
  } catch {
    checks.push({ name: "serverUrl", ok: false, code: "CONFIG_INVALID", message: "Server URL must be http or https" });
    return { ok: false, checks };
  }

  checks.push({ name: "serverUrl", ok: true, message: "Server URL is valid" });

  const health = await requestJson(config, "/api/health", { fetchImpl });
  if (isErrorResult(health)) {
    checks.push({ name: "server", ok: false, code: health.error.code, message: health.error.message });
    return { ok: false, checks };
  }
  if (!isHealthy(health)) {
    checks.push({ name: "server", ok: false, code: "HTTP_INVALID_RESPONSE", message: "Health check returned an unexpected response" });
    return { ok: false, checks };
  }

  checks.push({ name: "server", ok: true, message: "Server health check passed" });

  const categories = await requestJson(config, "/api/categories", { fetchImpl });
  if (isErrorResult(categories)) {
    checks.push({ name: "auth", ok: false, code: categories.error.code, message: categories.error.message });
    return { ok: false, checks };
  }
  if (!isValidReadOnlyResponse(categories)) {
    checks.push({ name: "auth", ok: false, code: "HTTP_INVALID_RESPONSE", message: "Read-only API returned an unexpected response" });
    return { ok: false, checks };
  }

  checks.push({ name: "auth", ok: true, message: "Read-only API check passed" });
  return { ok: true, checks };
}
