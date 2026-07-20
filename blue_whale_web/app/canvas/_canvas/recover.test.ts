import { describe, it, expect } from "vitest";
import { jobToPlaceholder } from "./recover";
import type { JobListItem } from "./api/generation";

function job(over: Partial<JobListItem> = {}): JobListItem {
  return {
    jobId: 100,
    type: "image",
    status: "processing",
    progress: 0,
    input: { prompt: "一只猫", aspectRatio: "1:1" },
    createdAt: "",
    outputAssets: null,
    ...over,
  };
}

describe("jobToPlaceholder (D12 刷新恢复)", () => {
  it("image job → loading 占位，content 取 prompt，id=job-{jobId}", () => {
    const r = jobToPlaceholder(job());
    expect(r.id).toBe("job-100");
    expect(r.type).toBe("image");
    expect(r.patch.status).toBe("loading");
    expect(r.patch.content).toBe("一只猫");
  });

  it("尺寸按 input.aspectRatio（16:9 → 356×200）", () => {
    const r = jobToPlaceholder(job({ input: { prompt: "风景", aspectRatio: "16:9" } }));
    expect(r.patch.width).toBe(356);
    expect(r.patch.height).toBe(200);
  });

  it("video job → type=video + 带 progress（D16）", () => {
    const r = jobToPlaceholder(job({ type: "video", progress: 45 }));
    expect(r.type).toBe("video");
    expect(r.patch.progress).toBe(45);
  });

  it("image job 不带 progress（图片无进度数据）", () => {
    const r = jobToPlaceholder(job({ progress: 50 }));
    expect(r.patch.progress).toBeUndefined();
  });

  it("input 为 null → 回退（空 prompt、1:1 → 200×200）", () => {
    const r = jobToPlaceholder(job({ input: null }));
    expect(r.patch.content).toBe("");
    expect(r.patch.width).toBe(200);
    expect(r.patch.height).toBe(200);
  });

  it("input 缺 aspectRatio → 回退 1:1", () => {
    const r = jobToPlaceholder(job({ input: { prompt: "x" } }));
    expect(r.patch.width).toBe(200);
    expect(r.patch.height).toBe(200);
  });

  it("不同 jobId → 不同稳定 id（去重基础）", () => {
    expect(jobToPlaceholder(job({ jobId: 1 })).id).toBe("job-1");
    expect(jobToPlaceholder(job({ jobId: 2 })).id).toBe("job-2");
  });
});
