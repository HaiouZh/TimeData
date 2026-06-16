import { runCategories } from "./categories.js";
import { runDoctor } from "./doctor.js";
import { runList } from "./list.js";
import { runLog } from "./log.js";
import { runNotes } from "./notes.js";
import { runTasks, runTaskDone, runTaskSchedule, runTaskTag, runTaskTurn, runTaskUnschedule } from "./tasks.js";
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

function requireConfig(config: ApiConfig | null): ApiConfig {
  if (!config) throw new Error("Command requires resolved config");
  return config;
}

export const commandRegistry: CommandHelp[] = [
  {
    name: "categories",
    writesData: false,
    summary: "List active categories with AI-safe category paths.",
    usage: "timedata categories [--server URL] [--token TOKEN]",
    handler: (ctx) => runCategories(requireConfig(ctx.config), ctx.fetchImpl),
  },
  {
    name: "list",
    writesData: false,
    summary: "List time entries for one local date in CLI format.",
    usage: "timedata list [--date YYYY-MM-DD] [--server URL] [--token TOKEN]",
    handler: (ctx) => runList(requireConfig(ctx.config), ctx.flags, ctx.fetchImpl),
  },
  {
    name: "log",
    writesData: true,
    summary: "Create one time entry through the server API.",
    usage: "timedata log --start HH:mm --end HH:mm --category <path> [--date YYYY-MM-DD] [--note TEXT] [--server URL] [--token TOKEN]",
    handler: (ctx) => runLog(requireConfig(ctx.config), ctx.flags, ctx.fetchImpl),
  },
  {
    name: "notes",
    writesData: false,
    summary: "List quick notes by local date, date range, or recent window.",
    usage: "timedata notes [--date YYYY-MM-DD | --from YYYY-MM-DD --to YYYY-MM-DD | --recent --limit N] [--server URL] [--token TOKEN]",
    handler: (ctx) => runNotes(requireConfig(ctx.config), ctx.flags, ctx.fetchImpl),
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
  {
    name: "tasks",
    writesData: false,
    summary: "List tasks from the server.",
    usage: "timedata tasks [--kind pool|recurring] [--done 0|1] [--server URL] [--token TOKEN]",
    handler: (ctx) => runTasks(requireConfig(ctx.config), ctx.flags, ctx.fetchImpl),
  },
  {
    name: "task-schedule",
    writesData: true,
    summary: "Schedule a task for a specific date through the server API.",
    usage: "timedata task-schedule --id ID --date YYYY-MM-DD [--server URL] [--token TOKEN]",
    handler: (ctx) => runTaskSchedule(requireConfig(ctx.config), ctx.flags, ctx.fetchImpl),
  },
  {
    name: "task-unschedule",
    writesData: true,
    summary: "Remove the scheduled date from a task through the server API.",
    usage: "timedata task-unschedule --id ID [--server URL] [--token TOKEN]",
    handler: (ctx) => runTaskUnschedule(requireConfig(ctx.config), ctx.flags, ctx.fetchImpl),
  },
  {
    name: "task-running",
    writesData: true,
    summary: "Mark a task as running through the scoped agent API.",
    usage: "timedata task-running --id ID [--server URL] [--token TOKEN]",
    handler: (ctx) => runTaskTurn("running", requireConfig(ctx.config), ctx.flags, ctx.fetchImpl),
  },
  {
    name: "task-handback",
    writesData: true,
    summary: "Hand a task back for review through the scoped agent API.",
    usage: "timedata task-handback --id ID [--note TEXT] [--server URL] [--token TOKEN]",
    handler: (ctx) => runTaskTurn("me", requireConfig(ctx.config), ctx.flags, ctx.fetchImpl),
  },
  {
    name: "task-park",
    writesData: true,
    summary: "Park a task through the scoped agent API.",
    usage: "timedata task-park --id ID [--server URL] [--token TOKEN]",
    handler: (ctx) => runTaskTurn("parked", requireConfig(ctx.config), ctx.flags, ctx.fetchImpl),
  },
  {
    name: "task-done",
    writesData: true,
    summary: "Complete a task through the scoped agent API.",
    usage: "timedata task-done --id ID [--server URL] [--token TOKEN]",
    handler: (ctx) => runTaskDone(requireConfig(ctx.config), ctx.flags, ctx.fetchImpl),
  },
  {
    name: "task-tag",
    writesData: true,
    summary: "Set a task's tags through the scoped agent API.",
    usage: "timedata task-tag --id ID --tags agent,idea [--server URL] [--token TOKEN]",
    handler: (ctx) => runTaskTag(requireConfig(ctx.config), ctx.flags, ctx.fetchImpl),
  },
];

const redLines = [
  "Do not edit SQLite database files directly.",
  "Do not edit IndexedDB directly.",
  "Do not edit sync logs directly.",
  "Do not edit Backup JSON or JSONL/CSV export files to write data back.",
  "Use timedata log as the only current AI/script data-writing command.",
  "Use timedata notes for read-only quick notes access; it does not write data.",
  "Use timedata task-schedule / task-unschedule to change task schedule; they write only through the server API.",
  "Use timedata task-running / task-handback / task-park / task-done / task-tag for agent task status write-back through the scoped server API.",
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
