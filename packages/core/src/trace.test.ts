import { describe, expect, it } from "vitest";

import {
  generateTraceId,
  getCurrentTraceId,
  getOrCreateTraceId,
  runWithTraceId,
} from "./trace.js";

describe("getOrCreateTraceId —— 透传优先、缺省生成", () => {
  it("入参非空时原样透传", () => {
    expect(getOrCreateTraceId("trace-from-upstream")).toBe("trace-from-upstream");
  });

  it("入参两端空白时 trim 后透传", () => {
    expect(getOrCreateTraceId("  abc-123  ")).toBe("abc-123");
  });

  it("入参缺省/空串/纯空白时生成", () => {
    for (const value of [undefined, null, "", "   "]) {
      const generated = getOrCreateTraceId(value);
      expect(generated).toMatch(/^[0-9]+-[0-9a-f]{16}$/);
    }
  });

  it("入参含非法字符（中文/换行）时不沿用，改生成", () => {
    expect(getOrCreateTraceId("链路a")).toMatch(/^[0-9]+-[0-9a-f]{16}$/);
    expect(getOrCreateTraceId("a\nb")).toMatch(/^[0-9]+-[0-9a-f]{16}$/);
  });

  it("generateTraceId 每次不同", () => {
    expect(generateTraceId()).not.toBe(generateTraceId());
  });
});

describe("runWithTraceId —— 异步上下文传播", () => {
  it("上下文内同步/异步均可读到，上下文外为空", async () => {
    expect(getCurrentTraceId()).toBeNull();
    await runWithTraceId("trace-ctx", async () => {
      expect(getCurrentTraceId()).toBe("trace-ctx");
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getCurrentTraceId()).toBe("trace-ctx");
    });
    expect(getCurrentTraceId()).toBeNull();
  });

  it("嵌套上下文内层覆盖、外层恢复", () => {
    runWithTraceId("outer", () => {
      runWithTraceId("inner", () => {
        expect(getCurrentTraceId()).toBe("inner");
      });
      expect(getCurrentTraceId()).toBe("outer");
    });
  });
});
