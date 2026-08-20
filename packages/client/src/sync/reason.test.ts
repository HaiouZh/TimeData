import { describe, it, expect } from "vitest";
import { classifyReasonCode } from "./reason.js";

describe("classifyReasonCode", () => {
  it("applied → applied", () => {
    expect(classifyReasonCode("applied")).toBe("applied");
  });

  it("missing_payload / invalid_shape / id_mismatch → client_bug", () => {
    expect(classifyReasonCode("missing_payload")).toBe("client_bug");
    expect(classifyReasonCode("invalid_shape")).toBe("client_bug");
    expect(classifyReasonCode("id_mismatch")).toBe("client_bug");
  });

  it("archived_category / missing_category / overlap / invalid_time_range → user_actionable", () => {
    expect(classifyReasonCode("archived_category")).toBe("user_actionable");
    expect(classifyReasonCode("missing_category")).toBe("user_actionable");
    expect(classifyReasonCode("overlap")).toBe("user_actionable");
    expect(classifyReasonCode("invalid_time_range")).toBe("user_actionable");
  });

  it("server_version_newer_or_same → conflict", () => {
    expect(classifyReasonCode("server_version_newer_or_same")).toBe("conflict");
  });

  it("stale_change_rejected → stale_rejected", () => {
    expect(classifyReasonCode("stale_change_rejected")).toBe("stale_rejected");
  });

  it("orphan_step_rejected → stale_rejected", () => {
    expect(classifyReasonCode("orphan_step_rejected")).toBe("stale_rejected");
  });

  it("orphan_milestone_rejected → stale_rejected", () => {
    expect(classifyReasonCode("orphan_milestone_rejected")).toBe("stale_rejected");
  });

  it("foreign_key_failed → user_actionable", () => {
    expect(classifyReasonCode("foreign_key_failed")).toBe("user_actionable");
  });

  it("未知 reasonCode → unknown", () => {
    expect(classifyReasonCode("something_new")).toBe("unknown");
  });

  it("classifies unseen_record_deletion_rejected as needs_arbitration", () => {
    expect(classifyReasonCode("unseen_record_deletion_rejected")).toBe("needs_arbitration");
  });

  // 归错类会让整个修复归零：user_actionable 在 200 路径不标记 syncLog，
  // stale_rejected 不保存本地内容。这条守的是那个选择本身。
  it("does not classify unseen_record_deletion_rejected as user_actionable or stale_rejected", () => {
    const category = classifyReasonCode("unseen_record_deletion_rejected");
    expect(category).not.toBe("user_actionable");
    expect(category).not.toBe("stale_rejected");
  });
});
