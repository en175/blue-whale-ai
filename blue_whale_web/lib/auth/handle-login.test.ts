import { describe, expect, it, vi } from "vitest";

import { handleLogin } from "./handle-login.js";

// login 路由处理器：手机号+码校验 → loginWithCode → {code,msg,data:{accessToken,user}}。
function makeDeps() {
  return {
    db: {
      findValidCode: vi.fn().mockResolvedValue({ id: "code-1" }),
      upsertUser: vi.fn().mockResolvedValue({
        id: "user-9",
        username: "用户XXXX",
        phone: "15079999999",
      }),
      markCodeUsed: vi.fn().mockResolvedValue(undefined),
    },
    jwt: { issueAccessToken: vi.fn().mockResolvedValue("tok.access") },
  };
}

describe("handleLogin", () => {
  it("合法 phone+code → 200 + {accessToken, user}", async () => {
    const deps = makeDeps();
    const result = await handleLogin({ phone: "15079999999", code: "123456" }, deps);
    expect(result).toEqual({
      code: 200,
      msg: null,
      data: {
        accessToken: "tok.access",
        user: { id: "user-9", username: "用户XXXX", phone: "15079999999" },
      },
    });
  });

  it("验证码无效 → 400", async () => {
    const deps = makeDeps();
    deps.db.findValidCode = vi.fn().mockResolvedValue(null);
    const result = await handleLogin({ phone: "15079999999", code: "wrong" }, deps);
    expect(result.code).toBe(400);
  });

  it("非法手机号 → 400，不查码", async () => {
    const deps = makeDeps();
    const result = await handleLogin({ phone: "123", code: "123456" }, deps);
    expect(result.code).toBe(400);
    expect(deps.db.findValidCode).not.toHaveBeenCalled();
  });
});
