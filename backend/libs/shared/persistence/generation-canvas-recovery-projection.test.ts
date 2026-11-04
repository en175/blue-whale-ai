import { describe, expect, it } from "vitest";

import { jobDetailView } from "./generation-canvas-recovery-repo.js";

const BASE = {
  id: 42n,
  type: "image",
  status: "failed",
  progress: 0,
  output_asset_ids: [],
  gmt_create: new Date("2026-11-04T00:00:00Z"),
};

describe("恢复快照任务错误投影（IKST3J）", () => {
  it("1016 只下发公开文案，不暴露内部原文", () => {
    const view = jobDetailView({
      ...BASE,
      error: { code: "storage_failed", message: "oss timeout" },
    });

    expect(view.stored_error).toMatchObject({
      code: 1016,
      message: "结果保存失败，结果暂未恢复。",
      category: "storage",
      retryable: false,
    });
    expect(JSON.stringify(view)).not.toContain("oss timeout");
  });

  it("无错误时保持 null", () => {
    expect(jobDetailView({ ...BASE, status: "succeeded", error: null }).stored_error)
      .toBeNull();
  });

  it("未知码回落为类型级失败文案，不回落原始 message", () => {
    const view = jobDetailView({
      ...BASE,
      error: { code: "totally_unknown", message: "internal stacktrace" },
    });

    expect(JSON.stringify(view)).not.toContain("internal stacktrace");
    expect(view.stored_error).toMatchObject({ category: expect.any(String) });
  });
});
