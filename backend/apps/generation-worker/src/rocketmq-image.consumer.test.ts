import { describe, expect, it, vi } from "vitest";

import { loadImageConcurrency } from "./rocketmq-image.consumer.js";

describe("loadImageConcurrency", () => {
  it("缺省 20（消费线程数默认值）", () => {
    expect(loadImageConcurrency({})).toBe(20);
  });

  it("IMAGE_CONCURRENCY 显式指定优先", () => {
    expect(loadImageConcurrency({ IMAGE_CONCURRENCY: "5" })).toBe(5);
  });

  it("非法值回落默认 20", () => {
    expect(loadImageConcurrency({ IMAGE_CONCURRENCY: "abc" })).toBe(20);
    expect(loadImageConcurrency({ IMAGE_CONCURRENCY: "0" })).toBe(20);
    expect(loadImageConcurrency({ IMAGE_CONCURRENCY: "65" })).toBe(20);
  });
});
