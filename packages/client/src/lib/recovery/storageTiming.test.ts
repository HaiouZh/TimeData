import { describe, expect, it } from "vitest";
import { STORAGE_ERROR_NAME_MAX, storageErrorName, timeStorageProbe } from "./storageTiming.ts";

describe("storageErrorName", () => {
  it("只取错误类型名，不取消息正文", () => {
    const error = new Error("用户数据：秘密内容");
    error.name = "UnknownError";
    expect(storageErrorName(error)).toBe("UnknownError");
  });

  it("Dexie 包装错误带内层名：外层/内层", () => {
    const error = Object.assign(new Error("x"), { name: "DatabaseClosedError", inner: { name: "UnknownError" } });
    expect(storageErrorName(error)).toBe("DatabaseClosedError/UnknownError");
  });

  it("非 Error 值：记类型；超长截断到上限", () => {
    expect(storageErrorName("boom")).toBe("string");
    expect(storageErrorName({ name: "N".repeat(200) })).toHaveLength(STORAGE_ERROR_NAME_MAX);
  });
});

describe("timeStorageProbe", () => {
  it("成功：记耗时，errorName 为 null", async () => {
    let t = 10;
    const result = await timeStorageProbe(async () => {
      t = 55;
    }, () => t);
    expect(result).toEqual({ ms: 45, errorName: null });
  });

  // 逃逸变异：抛错时不捕获 → 调用方拿到 rejection，存储报错与存储被冻又混成一种。
  it("抛错：不 reject，记耗时与错误名", async () => {
    let t = 0;
    const result = await timeStorageProbe(async () => {
      t = 30;
      throw Object.assign(new Error("x"), { name: "InvalidStateError" });
    }, () => t);
    expect(result).toEqual({ ms: 30, errorName: "InvalidStateError" });
  });
});
