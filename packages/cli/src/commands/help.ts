import { runCategories } from "./categories.js";
import { runDoctor } from "./doctor.js";
import { runList } from "./list.js";
import { runLog } from "./log.js";
import { runVersion } from "./version.js";
import type { ApiConfig } from "../lib/api-client.js";
import type { FileConfigResult } from "../lib/config.js";

export interface CommandContext {
  config: ApiConfig | null;
  flags: Record<string, string | undefined>;
  env: Record<string, string | undefined>;
  fileConfig: FileConfigResult;
  fetchImpl?: typeof fetch;
}

export interface CommandHelp {
  name: string;
  writesData: boolean;
  summary: string;
  usage: string;
  handler?: (ctx: CommandContext) => Promise<unknown> | unknown;
}

export const commandRegistry: CommandHelp[] = [
  {
    name: "categories",
    writesData: false,
    summary: "List active categories with AI-safe category paths.",
    usage: "timedata categories [--server URL] [--token TOKEN]",
    handler: (ctx) => runCategories(ctx.config!, ctx.fetchImpl),
  },
  {
    name: "list",
    writesData: false,
    summary: "List time entries for one local date in CLI format.",
    usage: "timedata list [--date YYYY-MM-DD] [--server URL] [--token TOKEN]",
    handler: (ctx) => runList(ctx.config!, ctx.flags, ctx.fetchImpl),
  },
  {
    name: "log",
    writesData: true,
    summary: "Create one time entry through the server API.",
    usage: "timedata log --start HH:mm --end HH:mm --category <path> [--date YYYY-MM-DD] [--note TEXT] [--server URL] [--token TOKEN]",
    handler: (ctx) => runLog(ctx.config!, ctx.flags, ctx.fetchImpl),
  },
  {
    name: "help",
    writesData: false,
    summary: "Show this JSON help without reading server configuration.",
    usage: "timedata help [command]",
  },
  {
    name: "doctor",
    writesData: false,
    summary: "Check CLI configuration, server reachability, and read-only authentication with TIMEDATA_SERVER_URL and TIMEDATA_TOKEN.",
    usage: "timedata doctor [--server URL] [--token TOKEN]",
    handler: (ctx) => runDoctor(ctx.flags, ctx.env, ctx.fileConfig, ctx.fetchImpl),
  },
  {
    name: "version",
    writesData: false,
    summary: "Print the CLI version and git sha baked in at build time.",
    usage: "timedata version",
    handler: (ctx) => runVersion(ctx.env),
  },
];

const redLines = [
  "Do not edit SQLite database files directly.",
  "Do not edit IndexedDB directly.",
  "Do not edit sync logs directly.",
  "Do not edit Backup JSON or JSONL/CSV export files to write data back.",
  "Use timedata log as the only current AI/script data-writing command.",
];

const docs = ["docs/TimeData-CLI-AI.md", "docs/evergreen/cli.md", "docs/adr/0001-cli-as-only-write-path.md"];

export function runHelp(topic?: string): unknown {
  const selected = topic ? commandRegistry.filter((command) => command.name === topic) : commandRegistry;
  if (topic && selected.length === 0) {
    return { ok: false, error: { code: "UNKNOWN_COMMAND", message: `Unknown command: ${topic}` } };
  }

  return {
    ok: true,
    command: "help",
    ...(topic ? { topic } : {}),
    commands: selected,
    redLines,
    docs,
  };
}

export function isKnownCommand(command: string): boolean {
  return commandRegistry.some((item) => item.name === command);
}
