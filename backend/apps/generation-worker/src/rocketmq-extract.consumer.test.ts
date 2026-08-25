import { describe, expect, it } from "vitest";

import { loadMediaExtractConcurrency } from "./rocketmq-extract.consumer.js";

describe("loadMediaExtractConcurrency", () => {
  it("uses an explicit MEDIA_EXTRACT_CONCURRENCY env override", () => {
    expect(
      loadMediaExtractConcurrency({ MEDIA_EXTRACT_CONCURRENCY: "3" } as never),
    ).toBe(3);
    expect(
      loadMediaExtractConcurrency({ MEDIA_EXTRACT_CONCURRENCY: "1" } as never),
    ).toBe(1);
    expect(
      loadMediaExtractConcurrency({ MEDIA_EXTRACT_CONCURRENCY: "16" } as never),
    ).toBe(16);
  });

  it("falls back to default 2 for invalid or missing env", () => {
    // 越界 / 非数字 / 缺省 → 默认 2（对齐容器 2 核部署）
    for (const raw of ["0", "17", "abc", "-1", ""]) {
      expect(
        loadMediaExtractConcurrency({ MEDIA_EXTRACT_CONCURRENCY: raw } as never),
      ).toBe(2);
    }
    expect(loadMediaExtractConcurrency({} as never)).toBe(2);
  });
});
