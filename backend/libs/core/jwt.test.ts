import { describe, expect, it } from "vitest";

import { issueAccessToken, verifyAccessToken } from "./jwt.js";

// 对齐 Java blue-whale-user JwtUtil：HS256，access token claims = { sub: userId, phone, type: "access" }，15min。
const SECRET = "blue-whale-test-secret-key-at-least-256-bits!!";

describe("jwt (HS256, 对齐 Java JwtUtil)", () => {
  it("round-trips an access token: issue -> verify -> claims", async () => {
    const token = await issueAccessToken("123", "15079999999", SECRET);

    const payload = await verifyAccessToken(token, SECRET);
    expect(payload).toEqual({
      userId: "123",
      phone: "15079999999",
      type: "access",
    });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await issueAccessToken("123", "15079999999", SECRET);
    await expect(
      verifyAccessToken(token, "wrong-secret-key-at-least-256-bits-long!!"),
    ).rejects.toThrow();
  });

  it("produces a compact JWT string with 3 segments", async () => {
    const token = await issueAccessToken("1", "1", SECRET);
    expect(token.split(".")).toHaveLength(3);
  });

  it("access token 过期时间为签发后 7 天（单 token，无 refresh）", async () => {
    const token = await issueAccessToken("1", "1", SECRET);
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    ) as { iat: number; exp: number };
    expect(payload.exp - payload.iat).toBe(7 * 24 * 60 * 60);
  });
});
