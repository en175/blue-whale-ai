import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";

export function sealGenerationCredential(token: string, secret: string): string {
  const key = credentialKey(secret);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    nonce.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function openGenerationCredential(
  ciphertext: string,
  secret: string,
): string {
  const [version, nonceValue, tagValue, encryptedValue] = ciphertext.split(".");
  if (
    version !== VERSION ||
    !nonceValue ||
    !tagValue ||
    !encryptedValue
  ) {
    throw new Error("生成凭证密文无效");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    credentialKey(secret),
    Buffer.from(nonceValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function credentialKey(secret: string): Buffer {
  if (secret.length < 16) throw new Error("生成凭证密钥长度不足");
  return createHash("sha256").update(secret).digest();
}
