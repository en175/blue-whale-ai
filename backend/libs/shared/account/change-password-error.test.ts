// IKBQEE / ADR-0078：账号域错误投影单测——网关英文/中文 message 归一为账号域数值码 + 中文。
import { describe, expect, it } from "vitest";

import { NewApiError } from "@blue-whale/core";
import { projectAccountError } from "./change-password-error.js";

describe("projectAccountError", () => {
  it("网关英文原密码错误 → 1101 原密码错误，请重试", () => {
    const out = projectAccountError(
      new NewApiError("Original password is incorrect", 400),
      "修改密码失败",
    );
    expect(out).toEqual({ code: 1101, message: "原密码错误，请重试" });
  });

  it("网关中文原密码错误 → 1101", () => {
    const out = projectAccountError(
      new NewApiError("原密码错误", 400),
      "修改密码失败",
    );
    expect(out.code).toBe(1101);
  });

  it("网关 Invalid input（密码格式） → 1102 新密码需为 8-20 位", () => {
    const out = projectAccountError(
      new NewApiError("Invalid input", 200),
      "修改密码失败",
    );
    expect(out).toEqual({ code: 1102, message: "新密码需为 8-20 位" });
  });

  it("网关未设置密码 → 1103", () => {
    const out = projectAccountError(
      new NewApiError("当前账号未设置密码", 200),
      "修改密码失败",
    );
    expect(out).toEqual({ code: 1103, message: "当前账号未设置密码" });
  });

  it("网关英文 password not set → 1103", () => {
    const out = projectAccountError(
      new NewApiError("password not set", 200),
      "修改密码失败",
    );
    expect(out.code).toBe(1103);
  });

  it("密码格式错误含 incorrect 字样不误判为原密码错误（先匹配 invalid/length）", () => {
    const out = projectAccountError(
      new NewApiError("New password length is incorrect", 200),
      "修改密码失败",
    );
    expect(out).toEqual({ code: 1102, message: "新密码需为 8-20 位" });
  });

  it("网关英文 wrong password → 1101", () => {
    const out = projectAccountError(
      new NewApiError("wrong password", 400),
      "修改密码失败",
    );
    expect(out.code).toBe(1101);
  });

  it("无法归类错误 → 兜底 1100 + fallback 中文", () => {
    const out = projectAccountError(
      new NewApiError("upstream exploded", 500),
      "修改密码失败",
    );
    expect(out).toEqual({ code: 1100, message: "修改密码失败" });
  });

  it("非 Error 输入（字符串）也可投影", () => {
    const out = projectAccountError("Original password is incorrect", "修改密码失败");
    expect(out.code).toBe(1101);
  });
});
