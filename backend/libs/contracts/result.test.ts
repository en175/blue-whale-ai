import { describe, expect, it } from "vitest";

import { FAILURE_CODE, SUCCESS_CODE, fail, ok } from "./result.js";

describe("result envelope (matches Java Result<T>)", () => {
  it("SUCCESS_CODE = 200, FAILURE_CODE = 400", () => {
    expect(SUCCESS_CODE).toBe(200);
    expect(FAILURE_CODE).toBe(400);
  });

  it("ok(data) -> {code:200, msg:null, data}", () => {
    expect(ok({ id: 1 })).toEqual({ code: 200, msg: null, data: { id: 1 } });
  });

  it("ok() -> {code:200, msg:null, data:null}", () => {
    expect(ok()).toEqual({ code: 200, msg: null, data: null });
  });

  it("ok(data, msg) -> {code:200, msg, data}", () => {
    expect(ok({ id: 1 }, "created")).toEqual({
      code: 200,
      msg: "created",
      data: { id: 1 },
    });
  });

  it("fail(code, msg) -> {code, msg, data:null}", () => {
    expect(fail(401, "unauthorized")).toEqual({
      code: 401,
      msg: "unauthorized",
      data: null,
    });
  });

  it("fail(code, msg, data) -> {code, msg, data}", () => {
    expect(fail(100100, "data not found", { hint: "x" })).toEqual({
      code: 100100,
      msg: "data not found",
      data: { hint: "x" },
    });
  });
});
