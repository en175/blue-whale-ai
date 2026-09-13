import { describe, expect, it, vi } from "vitest";

import { loginWithCode } from "./login-with-code.js";

// loginWithCode 用例（DI 注入 db/jwt）。
// 行为对齐 Java AuthService.login：找未用过、未过期的码 → upsert users（按 phone 找或建）→ 标记码已用 → 签 access token。
describe("loginWithCode (happy path)", () => {
  it("验码通过 → upsert user → 标记码已用 → 签 access token → 返回 {accessToken, user}", async () => {
    const findValidCode = vi
      .fn()
      .mockResolvedValue({ id: "code-1" });
    const upsertUser = vi.fn().mockResolvedValue({
      id: "user-9",
      username: "用户XXXX",
      phone: "15079999999",
    });
    const markCodeUsed = vi.fn().mockResolvedValue(undefined);
    const issueAccessToken = vi.fn().mockResolvedValue("tok.access");

    const result = await loginWithCode(
      { phone: "15079999999", code: "123456" },
      {
        db: { findValidCode, upsertUser, markCodeUsed },
        jwt: { issueAccessToken },
      },
    );

    expect(result).toEqual({
      accessToken: "tok.access",
      user: { id: "user-9", username: "用户XXXX", phone: "15079999999" },
    });
    expect(findValidCode).toHaveBeenCalledWith("15079999999", "123456");
    expect(upsertUser).toHaveBeenCalledWith("15079999999");
    expect(markCodeUsed).toHaveBeenCalledWith("code-1");
    expect(issueAccessToken).toHaveBeenCalledWith("user-9", "15079999999");
  });
});
