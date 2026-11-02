import { describe, expect, it } from "vitest";

import { parseProjectSource } from "./project-source.js";

describe("parseProjectSource（IKRGON）", () => {
  it("缺省与空串视为未指定", () => {
    expect(parseProjectSource(undefined)).toEqual({ ok: true });
    expect(parseProjectSource(null)).toEqual({ ok: true });
    expect(parseProjectSource("")).toEqual({ ok: true });
  });

  it("识别两种来源", () => {
    expect(parseProjectSource("dialog")).toEqual({ ok: true, source: "dialog" });
    expect(parseProjectSource("canvas")).toEqual({ ok: true, source: "canvas" });
  });

  it("其它取值拒绝", () => {
    for (const value of ["other", "Dialog", 1, true, []]) {
      expect(parseProjectSource(value).ok).toBe(false);
    }
  });
});
