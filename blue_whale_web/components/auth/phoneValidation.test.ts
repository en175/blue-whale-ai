import { describe, it, expect } from "vitest";
import { sanitizePhone, isValidPhone } from "./phoneValidation";

describe("sanitizePhone", () => {
  it("剥非数字 + 截 11 位", () => {
    expect(sanitizePhone(" 138-0000 1234 ")).toBe("13800001234");
    expect(sanitizePhone("abc13800001234")).toBe("13800001234");
  });

  it("超过 11 位截断", () => {
    expect(sanitizePhone("13800001234999")).toBe("13800001234");
  });
});

describe("isValidPhone", () => {
  it("合法：首位 1 + 共 11 位", () => {
    expect(isValidPhone("13800001234")).toBe(true);
  });

  it("非法：首位非 1 / 位数不足 / 空 / 含非数字", () => {
    expect(isValidPhone("23800001234")).toBe(false);
    expect(isValidPhone("1380000123")).toBe(false);
    expect(isValidPhone("138000012349")).toBe(false);
    expect(isValidPhone("")).toBe(false);
  });
});
