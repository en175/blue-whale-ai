import { describe, expect, it } from "vitest";

import { changePasswordRequestSchema } from "./change-password.js";

// IKBRCK：修改密码请求体契约单测。命中非空校验 + .strict() 拒绝未知字段。
describe("change password request contract", () => {
  it("接受 original_password 与 password 的完整请求", () => {
    expect(
      changePasswordRequestSchema.parse({
        original_password: "OldPass123",
        password: "NewPass456",
      }),
    ).toEqual({ original_password: "OldPass123", password: "NewPass456" });
  });

  it("★ 原密码可缺（无口令账号走的是「设置密码」）、新密码缺一即拒绝", () => {
    // IKJA4R：手机号验证码建号的账号没有口令，前端不渲染旧密码框，请求体里就真的没有
    // `original_password`。有口令的账号仍必须提供——「给没给」在这里判，「给的对不对」
    // 在身份域判（`IdentityService.changePassword`）。
    expect(
      changePasswordRequestSchema.parse({ password: "NewPass456" }),
    ).toEqual({ password: "NewPass456" });

    for (const body of [
      { original_password: "OldPass123" },
      {},
    ]) {
      expect(() => changePasswordRequestSchema.parse(body)).toThrow();
    }
  });

  it("空串拒绝（min(1)）", () => {
    for (const body of [
      { original_password: "", password: "NewPass456" },
      { original_password: "OldPass123", password: "" },
    ]) {
      expect(() => changePasswordRequestSchema.parse(body)).toThrow();
    }
  });

  it("纯空白原密码拒绝（trim 后为空）", () => {
    expect(() =>
      changePasswordRequestSchema.parse({
        original_password: "   ",
        password: "NewPass456",
      }),
    ).toThrow();
  });

  it(".strict() 拒绝未知字段，防止网关多用途接口被意外带参", () => {
    expect(() =>
      changePasswordRequestSchema.parse({
        original_password: "OldPass123",
        password: "NewPass456",
        username: "hacked",
      }),
    ).toThrow();
  });
});
