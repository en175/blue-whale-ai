import { describe, it, expect } from "vitest";
import { generateUsername } from "./userName";

describe("generateUsername", () => {
  it("注入 rand=0 → 用户0000", () => {
    expect(generateUsername(() => 0)).toBe("用户0000");
  });

  it("注入 rand=0.9999 → 用户9999（上界）", () => {
    expect(generateUsername(() => 0.9999)).toBe("用户9999");
  });

  it("格式始终为 用户+4位数字", () => {
    expect(generateUsername(() => 0.5)).toMatch(/^用户\d{4}$/);
    expect(generateUsername()).toMatch(/^用户\d{4}$/);
  });
});
