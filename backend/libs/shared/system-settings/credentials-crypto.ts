/* ============================================
 * 系统设置里**加密字段**的封/解封（AES-256-GCM）
 *
 * ── 为什么凭证不能明文落库 ────────────────────────────────────────────────────
 *
 * 支付商户密钥能签出「支付成功」的回调，也能签出下单报文。它的三个副本——
 * 主库、从库/备份、以及任何拿到库读权限的人——都不会因为「我们只在管理端展示时脱敏」
 * 而少一个。所以存进去的就是密文：密钥在**进程环境变量**里（`SYSTEM_SETTINGS_SECRET`），
 * 库与密钥分开存放，只拿到库读不到凭证。
 *
 * ── 为什么是 GCM 而不是 CBC ──────────────────────────────────────────────────
 *
 * GCM 自带完整性校验：密文被改过一个字节，解密就会失败而不是解出垃圾数据。
 * 凭证被篡改成另一串「看起来合法」的商户号，比解不出来难排查得多。
 *
 * ── 信封格式 ────────────────────────────────────────────────────────────────
 *
 * ```
 * v1.<iv>.<tag>.<ciphertext>        （各段 base64url）
 * ```
 *
 * 前缀 `v1` 是为了**将来能换算法**：没有版本号的话，换算法就只能靠长度猜，
 * 或者一次性把所有行的密文都解出来重写（在库上做一次全表重写，谁都不敢先动手）。
 * ============================================ */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const SYSTEM_SETTINGS_SECRET_ENV = "SYSTEM_SETTINGS_SECRET";

/** 密钥缺失或格式不对。**fail closed**：不降级成明文。 */
export class SystemSettingsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SystemSettingsConfigError";
  }
}

const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12; // GCM 推荐长度
const KEY_BYTES = 32; // AES-256

/**
 * 解析主密钥。
 *
 * <p>接受两种写法：64 位十六进制，或 base64（解出 32 字节）。
 * 明确要求 32 字节而不是「任意口令 KDF 一下」：KDF 会让「口令有多弱」这件事从部署配置里
 * 消失，而这里没有校验弱口令的地方。宁可在配置阶段报错，也不要在线上悄悄用一个弱密钥。
 */
function masterKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = (env[SYSTEM_SETTINGS_SECRET_ENV] ?? "").trim();
  if (!raw) {
    throw new SystemSettingsConfigError(
      `凭证加密密钥未配置（缺环境变量 ${SYSTEM_SETTINGS_SECRET_ENV}）：` +
        `它必须与数据库分开存放；未配置时不写也不读凭证`,
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new SystemSettingsConfigError(
      `${SYSTEM_SETTINGS_SECRET_ENV} 须为 32 字节（64 位十六进制或 base64），实际解出 ${key.length} 字节`,
    );
  }
  return key;
}

/** 加密一段明文，返回可入库的信封。 */
export function sealSecret(plaintext: string, env: NodeJS.ProcessEnv = process.env): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey(env), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * 解密信封。
 *
 * <p>格式不对、版本不认识、认证标签对不上，一律抛——包括**看起来像明文的历史值**：
 * 那种情况只说明有人绕过本模块写过库，静默当成明文用会把「凭证已泄露」这件事盖住。
 */
export function openSecret(envelope: string, env: NodeJS.ProcessEnv = process.env): string {
  const parts = envelope.split(".");
  const [version, ivPart, tagPart, dataPart] = parts;
  if (parts.length !== 4 || version !== ENVELOPE_VERSION || !ivPart || !tagPart || !dataPart) {
    throw new SystemSettingsConfigError(
      `凭证密文信封格式不对（应为 ${ENVELOPE_VERSION}.<iv>.<tag>.<ciphertext>），` +
        `不接受明文或旧格式`,
    );
  }
  const key = masterKey(env);
  try {
    // ⚠️ **整段都在 try 里**，包括 createDecipheriv / setAuthTag。曾经只有 update+final 被包住，
    //    于是一段 Base64 合法但**长度不对**的 tag（比如被截断的密文）会让 Node 抛出裸的
    //    `TypeError: Invalid authentication tag length: 3` 一路冒到调用方——那既不是
    //    `SystemSettingsConfigError`（调用方按「配置坏了」处置的那一类），文案也毫无指向性。
    //    密文受损的处理口径只有一个：说清「解不开」，别把 Node 的内部措辞漏出去。
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // 只有两种可能：密钥换了，或密文被改过。原样抛出会把 GCM 的内部文案漏出去，
    // 也不会更有信息量——运维要查的是「密钥有没有变」。
    throw new SystemSettingsConfigError(
      "凭证解密失败：密钥与入库时不一致（或密文被改动过）",
    );
  }
}

/** 脱敏回显：只留尾 4 位。空值保持空串（前端据此显示「未配置」）。 */
export function maskSecret(value: string): string {
  if (!value) return "";
  return value.length <= 4 ? "****" : `****${value.slice(-4)}`;
}
