import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";
type GenerationCredentialEnvironment = Readonly<
  Record<string, string | undefined>
>;

export class GenerationCredentialConfigurationError extends Error {
  constructor() {
    super(
      "GENERATION_CREDENTIAL_SECRET must be configured with at least 16 characters",
    );
    this.name = "GenerationCredentialConfigurationError";
  }
}

export function loadGenerationCredentialSecret(
  environment: GenerationCredentialEnvironment = process.env,
): string {
  const secret = environment.GENERATION_CREDENTIAL_SECRET;
  if (!secret || secret.length < 16) {
    throw new GenerationCredentialConfigurationError();
  }
  return secret;
}

export function sealGenerationCredential(
  token: string,
  secret: string,
): string {
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
  if (version !== VERSION || !nonceValue || !tagValue || !encryptedValue) {
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
