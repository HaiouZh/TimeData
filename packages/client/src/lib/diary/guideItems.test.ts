import { describe, expect, it } from "vitest";
import { parseGuideItems } from "./guideItems.js";

describe("parseGuideItems", () => {
  it("按行拆分并 trim", () => {
    expect(parseGuideItems("回看昨日小记\n 亮点&成就 ")).toEqual(["回看昨日小记", "亮点&成就"]);
  });
  it("滤掉空行与纯空白行", () => {
    expect(parseGuideItems("a\n\n  \nb")).toEqual(["a", "b"]);
  });
  it("CRLF 同样拆开", () => {
    expect(parseGuideItems("a\r\nb")).toEqual(["a", "b"]);
  });
  it("空串与纯空白返回空数组", () => {
    expect(parseGuideItems("")).toEqual([]);
    expect(parseGuideItems("  \n ")).toEqual([]);
  });
});
