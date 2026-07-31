import { describe, expect, it } from "vitest";
import { reorderById } from "./navOrder.js";

describe("reorderById", () => {
  const items = [
    { to: "/", hidden: false },
    { to: "/todo", hidden: true },
    { to: "/tracks", hidden: false },
  ];

  it("moves an item forward", () => {
    expect(reorderById(items, "/todo", "/tracks", (item) => item.to)).toEqual([
      { to: "/", hidden: false },
      { to: "/tracks", hidden: false },
      { to: "/todo", hidden: true },
    ]);
  });

  it("moves an item backward", () => {
    expect(reorderById(items, "/tracks", "/", (item) => item.to)).toEqual([
      { to: "/tracks", hidden: false },
      { to: "/", hidden: false },
      { to: "/todo", hidden: true },
    ]);
  });

  it("returns a copy when ids are equal", () => {
    expect(reorderById(items, "/todo", "/todo", (item) => item.to)).toEqual(items);
  });

  it("returns the input order for unknown ids", () => {
    expect(reorderById(items, "/bogus", "/todo", (item) => item.to)).toEqual(items);
    expect(reorderById(items, "/todo", "/bogus", (item) => item.to)).toEqual(items);
  });
});