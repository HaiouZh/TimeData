import { describe, expect, it } from "vitest";
import { commandRegistry, runHelp } from "./help.js";

const expectedRedLines = [
  "Do not edit SQLite database files directly.",
  "Do not edit IndexedDB directly.",
  "Do not edit sync logs directly.",
  "Do not edit Backup JSON or JSONL/CSV export files to write data back.",
  "Use timedata log as the only current AI/script data-writing command.",
  "Use timedata notes for read-only quick notes access; it does not write data.",
  "Use timedata task-schedule / task-unschedule to change task schedule; they write only through the server API.",
  "Use timedata task-running / task-handback / task-park / task-done for agent task status write-back through the scoped server API.",
];

describe("runHelp", () => {
  it("exposes the command registry in stable order", () => {
    const names = commandRegistry.map((command) => command.name);

    expect(names).toEqual([
      "categories",
      "list",
      "log",
      "notes",
      "help",
      "doctor",
      "version",
      "tasks",
      "task-schedule",
      "task-unschedule",
      "task-running",
      "task-handback",
      "task-park",
      "task-done",
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("returns the full command catalog from the registry", () => {
    expect(runHelp()).toEqual({
      ok: true,
      command: "help",
      commands: commandRegistry,
      redLines: expectedRedLines,
      docs: ["docs/TimeData-CLI-AI.md", "docs/evergreen/cli.md", "docs/adr/0001-cli-as-only-write-path.md"],
    });
  });

  it("returns one command when a known command is requested", () => {
    expect(runHelp("log")).toEqual({
      ok: true,
      command: "help",
      topic: "log",
      commands: [commandRegistry.find((command) => command.name === "log")],
      redLines: expectedRedLines,
      docs: ["docs/TimeData-CLI-AI.md", "docs/evergreen/cli.md", "docs/adr/0001-cli-as-only-write-path.md"],
    });
  });

  it("mentions short-lived tokens in doctor guidance", () => {
    expect(JSON.stringify(runHelp("doctor"))).toContain("TIMEDATA_SERVER_URL");
    expect(JSON.stringify(runHelp("doctor"))).toContain("TIMEDATA_TOKEN");
  });

  it("returns UNKNOWN_COMMAND for an unknown help topic", () => {
    expect(runHelp("delete")).toEqual({
      ok: false,
      error: { code: "UNKNOWN_COMMAND", message: "Unknown command: delete" },
    });
  });
});
