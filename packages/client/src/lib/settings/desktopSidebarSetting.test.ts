import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../../test/dbReset.js";
import {
  DESKTOP_SIDEBAR_KEY,
  readDesktopSidebarConfig,
  sanitizeDesktopSidebarConfig,
  setDesktopSidebarConfig,
} from "./desktopSidebarSetting.js";

const defaultItems = [
  { to: "/quick-notes", placement: "primary" },
  { to: "/", placement: "primary" },
  { to: "/todo", placement: "primary" },
  { to: "/tracks", placement: "primary" },
  { to: "/goals", placement: "primary" },
  { to: "/stats/time", placement: "primary" },
  { to: "/stats/health", placement: "primary" },
  { to: "/settings", placement: "primary" },
] as const;

beforeEach(resetDb);

describe("desktopSidebarSetting", () => {
  it("defaults every main route to primary placement when unset", async () => {
    await expect(readDesktopSidebarConfig()).resolves.toEqual(defaultItems);
  });

  it("sanitizes placement, drops unknown routes, deduplicates and appends missing routes", () => {
    expect(
      sanitizeDesktopSidebarConfig({
        items: [
          { to: "/tracks", placement: "more" },
          { to: "/bogus", placement: "primary" },
          { to: "/tracks", placement: "primary" },
          { to: "/goals", placement: "nope" },
        ],
      }),
    ).toEqual([
      { to: "/tracks", placement: "more" },
      { to: "/goals", placement: "primary" },
      { to: "/quick-notes", placement: "primary" },
      { to: "/", placement: "primary" },
      { to: "/todo", placement: "primary" },
      { to: "/stats/time", placement: "primary" },
      { to: "/stats/health", placement: "primary" },
      { to: "/settings", placement: "primary" },
    ]);
  });

  it("falls back to defaults for invalid raw values", () => {
    expect(sanitizeDesktopSidebarConfig(null)[0]).toEqual({ to: "/quick-notes", placement: "primary" });
    expect(sanitizeDesktopSidebarConfig({ items: "bad" })[0]).toEqual({ to: "/quick-notes", placement: "primary" });
  });

  it("persists config and writes a settings syncLog", async () => {
    await setDesktopSidebarConfig([
      { to: "/tracks", placement: "primary" },
      { to: "/goals", placement: "more" },
    ]);

    await expect(readDesktopSidebarConfig()).resolves.toEqual([
      { to: "/tracks", placement: "primary" },
      { to: "/goals", placement: "more" },
      { to: "/quick-notes", placement: "primary" },
      { to: "/", placement: "primary" },
      { to: "/todo", placement: "primary" },
      { to: "/stats/time", placement: "primary" },
      { to: "/stats/health", placement: "primary" },
      { to: "/settings", placement: "primary" },
    ]);

    const logs = await db.syncLog.where("recordId").equals(DESKTOP_SIDEBAR_KEY).toArray();
    expect(logs[0]).toMatchObject({ tableName: "settings", action: "create", synced: 0 });
  });

  it("recovers from corrupted JSON stored in settings", async () => {
    await db.settings.put({
      key: DESKTOP_SIDEBAR_KEY,
      value: "{bad json",
      updatedAt: "2026-06-23T00:00:00.000Z",
    });

    await expect(readDesktopSidebarConfig()).resolves.toEqual(defaultItems);
  });
});
