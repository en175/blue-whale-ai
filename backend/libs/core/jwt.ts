import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

/**
 * 登录凭证（IKJAZL）：HS256 JWT，claims = `{ sub: userId, jti, type: "access" }`，7 天。
 *
 * <h2>claims 里为什么没有 `phone`</h2>
 *
 * 它曾经是**必填**（对齐 Java blue-whale-user 的 JwtUtil）。但存量用户是从 new-api
 * 迁来的，**一个手机号都没有**——把 phone 写进必填 claim，等于让这批人签不出凭证、
 * 也校验不过。手机号是渐进增强的标识（见 GLOSSARY「账号与密码」），不该进凭证。
 *
 * <h2>`jti` 为什么必须有</h2>
 *
 * 令牌内容由 `(claims, iat, exp)` 决定，而 `iat` 只到**秒**。同一秒内的两次登录
 * （双击、并发请求）会签出**逐字节相同**的 token，于是落进同一个 Redis 会话键——
 * 表现为「第二台设备登录后，第一台的会话被静默接管」。`jti` 让每次签发都唯一。
 */

export interface AccessTokenClaims {
  userId: string;
  /** 令牌唯一标识，见上文。 */
  jti: string;
  type: "access";
}

/** 7 天（对齐 gateway，统一不再发 refresh）；与 Redis 会话 TTL 同口径。 */
const ACCESS_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function issueAccessToken(
  userId: string,
  secret: string,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(key);
}

/**
 * 校验签名与有效期。
 *
 * <p>`exp` 由 `jwtVerify` 自己判（不像参考实现那样在中间件里手工比时间戳）——
 * 手工判容易漏掉时钟偏移与 `nbf` 这类标准项。
 *
 * @throws 签名不符 / 已过期 / claims 不完整
 */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenClaims> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("jwt missing sub");
  }
  if (payload.type !== "access") {
    throw new Error(`jwt not access token: ${String(payload.type)}`);
  }
  if (typeof payload.jti !== "string" || !payload.jti) {
    throw new Error("jwt missing jti");
  }
  return { userId: payload.sub, jti: payload.jti, type: "access" };
}
