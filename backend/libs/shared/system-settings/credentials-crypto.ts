import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const SYSTEM_SETTINGS_SECRET_ENV = "SYSTEM_SETTINGS_SECRET";

export class SystemSettingsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SystemSettingsConfigError";
  }
}

const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

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
    throw new SystemSettingsConfigError(
      "凭证解密失败：密钥与入库时不一致（或密文被改动过）",
    );
  }
}

export function maskSecret(value: string): string {
  if (!value) return "";
  return value.length <= 4 ? "****" : `****${value.slice(-4)}`;
}
