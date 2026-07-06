import { describe, it, expect } from "vitest";
import {
  sanitizePhone,
  isValidPhone,
  isValidCode,
  LOGIN_CODE,
} from "./phoneValidation";

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
    expect(isValidPhone("23800001234")).toBe(false); // 首位非 1
    expect(isValidPhone("1380000123")).toBe(false); // 10 位
    expect(isValidPhone("138000012349")).toBe(false); // 12 位
    expect(isValidPhone("")).toBe(false);
  });
});

describe("isValidCode", () => {
  it("LOGIN_CODE 写死 1234", () => {
    expect(LOGIN_CODE).toBe("1234");
    expect(isValidCode("1234")).toBe(true);
    expect(isValidCode("0000")).toBe(false);
    expect(isValidCode("")).toBe(false);
  });
});
