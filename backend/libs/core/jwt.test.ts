import { describe, expect, it } from "vitest";

import { issueAccessToken, verifyAccessToken } from "./jwt.js";

const SECRET = "blue-whale-test-secret-key-at-least-256-bits!!";

describe("jwt（登录凭证 HS256）", () => {
  it("round-trips an access token: issue -> verify -> claims", async () => {
    const token = await issueAccessToken("123", SECRET);

    const payload = await verifyAccessToken(token, SECRET);
    expect(payload).toMatchObject({ userId: "123", type: "access" });
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("★ 没有手机号的账号照样能签发与校验", async () => {
    const token = await issueAccessToken("42", SECRET);

    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("phone");
    await expect(verifyAccessToken(token, SECRET)).resolves.toMatchObject({
      userId: "42",
    });
  });

  it("★ 同一秒内两次签发得到不同令牌（jti 的意义）", async () => {
    const a = await issueAccessToken("7", SECRET);
    const b = await issueAccessToken("7", SECRET);
    expect(a).not.toBe(b);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await issueAccessToken("123", SECRET);
    await expect(
      verifyAccessToken(token, "wrong-secret-key-at-least-256-bits-long!!"),
    ).rejects.toThrow();
  });

  it("produces a compact JWT string with 3 segments", async () => {
    const token = await issueAccessToken("1", SECRET);
    expect(token.split(".")).toHaveLength(3);
  });

  it("access token 过期时间为签发后 7 天（单 token，无 refresh）", async () => {
    const token = await issueAccessToken("1", SECRET);
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    ) as { iat: number; exp: number };
    expect(payload.exp - payload.iat).toBe(7 * 24 * 60 * 60);
  });
});
