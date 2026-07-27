import { randomInt } from "node:crypto";

/** requestSmsCode 用例：依赖注入 db/sms，core 不直接耦合 persistence/volcengine。
 *  行为对齐 Java AuthService.sendCode（happy path）：生成 6 位码 → 写 verification_codes → 发短信。 */

const CODE_TTL_MS = 5 * 60 * 1000; // 300s，对齐 Java SMS 码 TTL

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
