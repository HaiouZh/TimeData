import { describe, expect, it } from "vitest";
import { runHelp } from "./help.js";

describe("runHelp", () => {
  it("returns the full command catalog", () => {
    expect(runHelp()).toEqual({
      ok: true,
      command: "help",
      commands: [
        {
          name: "categories",
          writesData: false,
          summary: "List active categories with AI-safe category paths.",
          usage: "timedata categories [--server URL] [--token TOKEN]",
        },
        {
          name: "list",
          writesData: false,
          summary: "List time entries for one local date in CLI format.",
          usage: "timedata list [--date YYYY-MM-DD] [--server URL] [--token TOKEN]",
        },
        {
          name: "log",
          writesData: true,
          summary: "Create one time entry through the server API.",
          usage: "timedata log --start HH:mm --end HH:mm --category <path> [--date YYYY-MM-DD] [--note TEXT] [--server URL] [--token TOKEN]",
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
          summary: "Check CLI configuration, server reachability, and read-only authentication.",
          usage: "timedata doctor [--server URL] [--token TOKEN]",
        },
        {
          name: "version",
          writesData: false,
          summary: "Print the CLI version and git sha baked in at build time.",
          usage: "timedata version",
        },
      ],
      redLines: [
        "Do not edit SQLite database files directly.",
        "Do not edit IndexedDB directly.",
        "Do not edit sync logs directly.",
        "Do not edit Backup JSON or JSONL/CSV export files to write data back.",
        "Use timedata log as the only current AI/script data-writing command.",
      ],
      docs: ["docs/TimeData-CLI-AI.md", "docs/evergreen/cli.md", "docs/adr/0001-cli-as-only-write-path.md"],
    });
  });

  it("returns one command when a known command is requested", () => {
    expect(runHelp("log")).toEqual({
      ok: true,
      command: "help",
      topic: "log",
      commands: [
        {
          name: "log",
          writesData: true,
          summary: "Create one time entry through the server API.",
          usage: "timedata log --start HH:mm --end HH:mm --category <path> [--date YYYY-MM-DD] [--note TEXT] [--server URL] [--token TOKEN]",
        },
      ],
      redLines: [
        "Do not edit SQLite database files directly.",
        "Do not edit IndexedDB directly.",
        "Do not edit sync logs directly.",
        "Do not edit Backup JSON or JSONL/CSV export files to write data back.",
        "Use timedata log as the only current AI/script data-writing command.",
      ],
      docs: ["docs/TimeData-CLI-AI.md", "docs/evergreen/cli.md", "docs/adr/0001-cli-as-only-write-path.md"],
    });
  });

  it("returns UNKNOWN_COMMAND for an unknown help topic", () => {
    expect(runHelp("delete")).toEqual({
      ok: false,
      error: { code: "UNKNOWN_COMMAND", message: "Unknown command: delete" },
    });
  });
});
