import { NewApiError } from "@blue-whale/core";
import { describe, expect, it, vi } from "vitest";

import { MeController } from "./me.controller.js";

// IKBRCK：PUT /me/password 改密端点的入口校验 + 透传 + 上游失败映射单测。
// 关键回归：AuthGuard 回注 sk- 令牌后，控制器必须自解析请求头 Bearer 并原样转给
// AccountService；原密码错误/账号未设密码这类网关业务失败要原样把 message 透出。

function createController(changePassword = vi.fn().mockResolvedValue(undefined)) {
  const account = { changePassword } as never;
  const controller = new MeController(account);
  return { controller, changePassword };
}

const USER = { userId: "42", username: "alice" } as never;
const BEARER = "Bearer sk-user-token";

describe("MeController（IKBRCK 改密）", () => {
  it("没有 Bearer 令牌就 401，不调上游", async () => {
    const { controller, changePassword } = createController();
    await expect(
      controller.changePassword(
        { original_password: "OldPass123", password: "NewPass456" },
        undefined,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("原密码或新密码缺失/为空就 400，不调上游", async () => {
    const { controller, changePassword } = createController();
    for (const body of [
      { original_password: "", password: "NewPass456" },
      { original_password: "  ", password: "NewPass456" },
      { original_password: "OldPass123", password: "" },
      {},
      { original_password: "OldPass123" },
      { password: "NewPass456" },
    ]) {
      await expect(
        controller.changePassword(body, BEARER),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("未知字段被契约 .strict() 拒绝（400），防止网关多用途接口被意外带参", async () => {
    const { controller, changePassword } = createController();
    await expect(
      controller.changePassword(
        {
          original_password: "OldPass123",
          password: "NewPass456",
          username: "hacked",
        },
        BEARER,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("合法入参：解析 Bearer 令牌并把 original_password/password 原样转给 AccountService", async () => {
    const { controller, changePassword } = createController();
    const result = await controller.changePassword(
      { original_password: "OldPass123", password: "NewPass456" },
      BEARER,
    );
    expect(result).toMatchObject({ code: 200 });
    expect(changePassword).toHaveBeenCalledWith(
      { originalPassword: "OldPass123", newPassword: "NewPass456" },
      "sk-user-token",
    );
  });

  it("网关业务失败（原密码错误）原样透出 message，4xx 保持原状态码", async () => {
    const { controller } = createController(
      vi.fn().mockRejectedValue(
        new NewApiError("原密码错误", 400),
      ),
    );
    await expect(
      controller.changePassword(
        { original_password: "wrong", password: "NewPass456" },
        BEARER,
      ),
    ).rejects.toMatchObject({ status: 400, message: "原密码错误" });
  });

  it("网关业务失败为非 4xx（如 success:false 的 200 信封）收敛成 502，但 message 保留", async () => {
    const { controller } = createController(
      vi.fn().mockRejectedValue(
        new NewApiError("当前账号未设置密码", 200),
      ),
    );
    await expect(
      controller.changePassword(
        { original_password: "OldPass123", password: "NewPass456" },
        BEARER,
      ),
    ).rejects.toMatchObject({ status: 502, message: "当前账号未设置密码" });
  });
});
