import { describe, it, expect } from "vitest";
import { ApiError, isApiError } from "./errors";

describe("ApiError", () => {
  it("装载 status / code / message / detail,message 走 Error 父类", () => {
    const e = new ApiError({
      status: 422,
      code: "validation_error",
      message: "prompt 不能为空",
      detail: { field: "prompt" },
    });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(422);
    expect(e.code).toBe("validation_error");
    expect(e.message).toBe("prompt 不能为空");
    expect(e.detail).toEqual({ field: "prompt" });
    expect(e.name).toBe("ApiError");
  });

  it("detail 可省略（业务错误体无 detail 段时）", () => {
    const e = new ApiError({ status: 404, code: "not_found", message: "asset 不存在" });
    expect(e.detail).toBeUndefined();
  });
});

describe("isApiError", () => {
  it("ApiError 实例 → true", () => {
    const e = new ApiError({ status: 500, code: "internal_error", message: "x" });
    expect(isApiError(e)).toBe(true);
  });

  it("原生 Error → false（不是 API 错误,不要误吞）", () => {
    expect(isApiError(new Error("boom"))).toBe(false);
  });

  it("字符串/数字/null/undefined → false", () => {
    expect(isApiError("ApiError")).toBe(false);
    expect(isApiError(500)).toBe(false);
    expect(isApiError(null)).toBe(false);
    expect(isApiError(undefined)).toBe(false);
  });

  it("形态近似但不属 ApiError 类的对象 → false", () => {
    const fake = { name: "ApiError", status: 500, code: "x", message: "x" };
    expect(isApiError(fake)).toBe(false);
  });
});
