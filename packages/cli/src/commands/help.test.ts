import { describe, expect, it } from "vitest";
import { commandRegistry, runHelp } from "./help.js";

describe("runHelp", () => {
  it("exposes the command registry in stable order", () => {
    const names = commandRegistry.map((command) => command.name);

    expect(names).toEqual(["categories", "list", "log", "help", "doctor", "version"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("returns the full command catalog from the registry", () => {
    expect(runHelp()).toEqual({
      ok: true,
      command: "help",
      commands: commandRegistry,
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
      commands: [commandRegistry.find((command) => command.name === "log")],
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
