import { SignJWT, jwtVerify } from "jose";

/** 对齐 Java blue-whale-user JwtUtil：HS256，access token claims = { sub: userId, phone, type: "access" }，15min。 */

export interface AccessTokenClaims {
  userId: string;
  phone: string;
  type: "access";
}

const ACCESS_TTL_SECONDS = 7 * 24 * 60 * 60; // 单 token（对齐 gateway，统一不再发 refresh），access 有效 7 天

export async function issueAccessToken(
  userId: string,
  phone: string,
  secret: string,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ phone, type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenClaims> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
  if (typeof payload.sub !== "string") throw new Error("jwt missing sub");
  if (payload.type !== "access") throw new Error(`jwt not access token: ${String(payload.type)}`);
  if (typeof payload.phone !== "string") throw new Error("jwt missing phone");
  return { userId: payload.sub, phone: payload.phone, type: "access" };
}
