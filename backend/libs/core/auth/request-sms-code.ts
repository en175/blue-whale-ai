import { randomInt } from "node:crypto";


const CODE_TTL_MS = 5 * 60 * 1000;

export interface RequestSmsCodeInput {
  phone: string;
  ip: string;
}

export interface VerificationCodeRecord {
  phone: string;
  code: string;
  ip: string;
  expiresAt: Date;
}

export interface RequestSmsCodeDeps {
  db: {
    createVerificationCode(record: VerificationCodeRecord): Promise<unknown>;
  };
  sms: {
    send(phone: string, code: string): Promise<unknown>;
  };
  generateCode?: () => string;
  now?: () => Date;
}

export interface RequestSmsCodeResult {
  code: string;
}

function defaultGenerateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function requestSmsCode(
  input: RequestSmsCodeInput,
  deps: RequestSmsCodeDeps,
): Promise<RequestSmsCodeResult> {
  const { db, sms, generateCode = defaultGenerateCode, now = () => new Date() } = deps;
  const code = generateCode();
  const expiresAt = new Date(now().getTime() + CODE_TTL_MS);
  await db.createVerificationCode({ phone: input.phone, code, ip: input.ip, expiresAt });
  await sms.send(input.phone, code);
  return { code };
}
