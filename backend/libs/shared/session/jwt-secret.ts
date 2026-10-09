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
