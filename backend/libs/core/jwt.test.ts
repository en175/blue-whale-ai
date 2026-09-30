import { describe, expect, it } from "vitest";

import { issueAccessToken, verifyAccessToken } from "./jwt.js";

// IKJAZL：登录凭证 = HS256 JWT，claims = { sub: userId, jti, type: "access" }，7 天。
// ⚠️ claims 里**没有 phone** —— 见下面那条专门钉住它的用例。
const SECRET = "blue-whale-test-secret-key-at-least-256-bits!!";

describe("jwt（登录凭证 HS256）", () => {
  it("round-trips an access token: issue -> verify -> claims", async () => {
    const token = await issueAccessToken("123", SECRET);

    const payload = await verifyAccessToken(token, SECRET);
    expect(payload).toMatchObject({ userId: "123", type: "access" });
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("★ 没有手机号的账号照样能签发与校验", async () => {
    // 钉住一个真实踩过的坑：老实现的 claims 里 `phone` 是**必填**（对齐 Java JwtUtil），
    // 而存量用户从 new-api 迁来、一个手机号都没有——那批人会集体签不出凭证。
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
    // 令牌内容由 (claims, iat, exp) 决定，而 iat 只到**秒**。没有 jti 的话，
    // 同秒两次登录会签出逐字节相同的 token，落进同一个 Redis 会话键——
    // 表现为「第二台设备登录后，第一台被静默接管」。
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
