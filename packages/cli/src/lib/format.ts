/**
 * Convert a CLI result object into either JSON (default, for AI / pipelines)
 * or a short human-readable summary (for interactive terminal users).
 *
 * Format selection rules:
 * - `--format=json` → JSON (default for backwards compatibility).
 * - `--format=human` → human summary.
 * - When `--format` is unset, fall back to `human` only if stdout is a TTY.
 */
export type OutputFormat = "json" | "human";

interface FormatContext {
  isTTY: boolean;
  format: string | undefined;
}

export function resolveOutputFormat(ctx: FormatContext): OutputFormat {
  if (ctx.format === "json") return "json";
  if (ctx.format === "human") return "human";
  return ctx.isTTY ? "human" : "json";
}

interface CommandResultLike {
  ok?: unknown;
  command?: unknown;
  [key: string]: unknown;
}

export function formatResult(result: unknown, format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }
  return renderHuman(result);
}

function renderHuman(result: unknown): string {
  if (!isPlainObject(result)) return JSON.stringify(result, null, 2);

  const data = result as CommandResultLike;
  if (data.ok === false) return renderError(data);
  if (data.command === "version") return renderVersion(data);
  if (data.command === "help") return renderHelp(data);
  if (Array.isArray((data as { categories?: unknown }).categories)) return renderCategories(data);
  if (Array.isArray((data as { entries?: unknown }).entries)) return renderEntries(data);
  if (Array.isArray((data as { checks?: unknown }).checks)) return renderDoctor(data);
  return JSON.stringify(result, null, 2);
}

function renderError(data: CommandResultLike): string {
  const error = data.error as { code?: string; message?: string; details?: Record<string, unknown> } | undefined;
  const lines = [
    `Error${error?.code ? ` [${error.code}]` : ""}: ${error?.message ?? "unknown error"}`,
  ];
  if (error?.details) {
    for (const [key, value] of Object.entries(error.details)) {
      lines.push(`  ${key}: ${formatValue(value)}`);
    }
  }
  return lines.join("\n");
}

function renderVersion(data: CommandResultLike): string {
  return `timedata ${String(data.version ?? "?")} (${String(data.gitSha ?? "dev")})`;
}

function renderHelp(data: CommandResultLike): string {
  const commands = Array.isArray(data.commands) ? data.commands : [];
  const lines = ["Commands:"];
  for (const cmd of commands) {
    if (!isPlainObject(cmd)) continue;
    const c = cmd as { name?: string; summary?: string; usage?: string; writesData?: boolean };
    lines.push(`  ${c.name}${c.writesData ? " (write)" : ""} — ${c.summary ?? ""}`);
    if (c.usage) lines.push(`    ${c.usage}`);
  }
  return lines.join("\n");
}

function renderCategories(data: CommandResultLike): string {
  const list = data.categories as Array<{ path?: string; id?: string }>;
  if (list.length === 0) return "No active categories.";
  return list.map((cat) => `${cat.path ?? "?"}  (${cat.id ?? ""})`).join("\n");
}

function renderEntries(data: CommandResultLike): string {
  const list = data.entries as Array<{
    startTime?: string;
    endTime?: string;
    category?: string;
    note?: string | null;
    durationMinutes?: number;
  }>;
  if (list.length === 0) return "No entries.";
  return list
    .map((entry) => {
      const start = entry.startTime?.slice(11, 16) ?? "?";
      const end = entry.endTime?.slice(11, 16) ?? "?";
      const duration = typeof entry.durationMinutes === "number" ? `${entry.durationMinutes}m` : "";
      return `${start}-${end}  ${entry.category ?? "?"}  ${duration}${entry.note ? `  // ${entry.note}` : ""}`.trim();
    })
    .join("\n");
}

function renderDoctor(data: CommandResultLike): string {
  const checks = data.checks as Array<{ name?: string; ok?: boolean; message?: string }>;
  return checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name ?? "?"} — ${c.message ?? ""}`).join("\n");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
