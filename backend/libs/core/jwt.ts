import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";


export interface AccessTokenClaims {
  userId: string;
  jti: string;
  type: "access";
}

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
