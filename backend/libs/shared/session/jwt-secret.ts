/**
 * 登录凭证的签名密钥（IKJAZL）。
 *
 * <h2>为什么不复用 `SYSTEM_SETTINGS_SECRET`</h2>
 *
 * 那个密钥（`system-settings/credentials-crypto.ts`）加密的是**落库的商户凭证**，
 * 能把明文还原出来；这一把只做 HMAC 签名，还原不了任何东西。两者的**轮换节奏**也
 * 完全不同：换这一把 = 所有人重新登录一次，换那一把 = 已存凭证全部解不开、得重录。
 * 合成一把，就意味着永远不敢换其中任何一个。
 *
 * <h2>开关为什么是 NODE_ENV</h2>
 *
 * 生产必须显式配置，非生产回退到一个**写死的开发默认值**——与
 * `redisConnectionOptions`（Redis 地址）和 `sessionCookieOptions`（cookie 的
 * `secure` 标志）同一个开关，不再新造一个。
 *
 * <p>⚠️ 那个默认值是**公开的**：任何人拿它都能自签一个 `sub` 任意的凭证。它只在
 * `NODE_ENV !== "production"` 下生效——这个判断之所以够用，是因为本仓**已经**拿它
 * 当安全开关了（cookie 的 `secure` 同样只看这一项）。换句话说，一个忘了设
 * `NODE_ENV=production` 的部署本来就已经在不安全状态，这一处不会让它更糟。
 *
 * <p>（凭证加密密钥没有这个回退，是刻意的：它缺失时**没有安全的降级选项**——
 * 回退成明文落库比启动失败糟得多，所以那边一律 fail closed。）
 */
const DEV_FALLBACK_SECRET = "dev-only-unsafe-session-jwt-secret";

export function sessionJwtSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const secret = env.SESSION_JWT_SECRET?.trim();
  if (secret) return secret;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_JWT_SECRET 必填（生产环境不提供默认值：登录凭证的签名密钥）",
    );
  }
  return DEV_FALLBACK_SECRET;
}
