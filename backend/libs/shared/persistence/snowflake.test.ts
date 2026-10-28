import { describe, expect, it } from "vitest";

import { nextSnowflake } from "./snowflake.js";

describe("nextSnowflake", () => {
  it("连续分配 1000 个互不重复", () => {
    const values = Array.from({ length: 1000 }, () => nextSnowflake());
    expect(new Set(values).size).toBe(values.length);
  });

  it("跨调用单调递增", () => {
    let previous = nextSnowflake();
    for (let i = 0; i < 1000; i += 1) {
      const current = nextSnowflake();
      expect(current > previous).toBe(true);
      previous = current;
    }
  });

  it("返回值落在 bigint 安全区间", () => {
    const value = nextSnowflake();
    expect(typeof value).toBe("bigint");
    expect(value).toBeGreaterThan(0n);
    expect(value).toBeLessThan(1n << 63n);
  });
});
