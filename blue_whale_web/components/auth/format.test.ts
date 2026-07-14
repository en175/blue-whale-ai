import { describe, it, expect } from "vitest";
import { maskPhone } from "./format";

describe("maskPhone", () => {
  it("11 位手机号 → 前3+****+后4", () => {
    expect(maskPhone("13800001234")).toBe("138****1234");
  });

  it("长度不足 11 位 → 原样返回（不脱敏，防短号泄露成空串）", () => {
    expect(maskPhone("138")).toBe("138");
    expect(maskPhone("1380000")).toBe("1380000");
  });

  it("超过 11 位 → 原样返回", () => {
    expect(maskPhone("138000012345")).toBe("138000012345");
  });

  it("空串 → 原样返回", () => {
    expect(maskPhone("")).toBe("");
  });
});
