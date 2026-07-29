import { createHash } from "node:crypto";
import { verifyAccessToken } from "@blue-whale/core";

function ownerIdFromNewApiToken(token: string): string {
  // The Node baseline stores project ownership as BIGINT. A token fingerprint
  // keeps ownership stable without introducing a second users/credits ledger.
  const digest = createHash("sha256").update(token).digest("hex").slice(0, 15);
  return (BigInt(`0x${digest}`) + BigInt(1)).toString();
}

/** 从 Authorization: Bearer <token> 验 JWT 取 userId。无效/缺失返回 null（路由返 401）。
 *  与 gateway 的 JwtAuthGlobalFilter 等价（同 jwt.secret + HS256 + sub），Node 自验、不依赖 gateway。 */
export async function getUserIdFromRequest(
  request: Request,
  jwtSecret: string,
): Promise<string | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (token.startsWith("sk-")) return ownerIdFromNewApiToken(token);
  try {
    const claims = await verifyAccessToken(token, jwtSecret);
    return claims.userId;
  } catch {
    return null;
  }
}
