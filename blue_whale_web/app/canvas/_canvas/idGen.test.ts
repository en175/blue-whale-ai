import { describe, it, expect } from "vitest";
import { createMessageIdGenerator } from "./idGen";

describe("createMessageIdGenerator", () => {
  it("连续多次调用返回互不相同的 ID（模拟同 tick 批量生成）", () => {
    const nextId = createMessageIdGenerator();
    const ids = Array.from({ length: 10 }, () => nextId());

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("返回值单调递增", () => {
    const nextId = createMessageIdGenerator();
    const a = nextId();
    const b = nextId();
    const c = nextId();

    expect(b).toBe(a + 1);
    expect(c).toBe(b + 1);
  });

  it("多个生成器实例互不干扰", () => {
    const genA = createMessageIdGenerator();
    const genB = createMessageIdGenerator();

    genA();
    genA();

    expect(genA()).not.toBe(genB());
  });
});
