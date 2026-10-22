import { Injectable } from "@nestjs/common";

import {
  LEGACY_VERIFICATION_PURPOSE,
  isVerificationPurpose,
} from "@lib/contracts";
import { isValidPhone, requestSmsCode } from "@lib/core";
import { createAuthRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { resolveSmsProvider, type SmsProvider } from "./sms.js";

const MAX_CODE_ATTEMPTS = 5;

export class InvalidPhoneError extends Error {
  constructor() {
    super("手机号格式不正确");
    this.name = "InvalidPhoneError";
  }
}

export class InvalidPhoneCodeInputError extends Error {
  constructor() {
    super("手机号和验证码不能为空");
    this.name = "InvalidPhoneCodeInputError";
  }
}

export function requirePhoneAndCode(input: {
  phone: unknown;
  code: unknown;
}): { phone: string; code: string } {
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!isValidPhone(phone) || !code) {
    throw new InvalidPhoneCodeInputError();
  }
  return { phone, code };
}

export class InvalidPurposeError extends Error {
  constructor() {
    super("验证码用途不正确");
    this.name = "InvalidPurposeError";
  }
}

export class CodeExpiredError extends Error {
  constructor() {
    super("验证码已失效，请重新获取");
    this.name = "CodeExpiredError";
  }
}

export class CodeWrongError extends Error {
  constructor(readonly remaining: number) {
    super("验证码错误，请重新输入");
    this.name = "CodeWrongError";
  }
}

export class CodeAttemptsExhaustedError extends Error {
  constructor() {
    super("验证码连续错误5次，已失效，请重新获取");
    this.name = "CodeAttemptsExhaustedError";
  }
}

export interface VerifiedPhoneCode {
  codeId: string;
}

export interface VerificationRequest {
  phone: string;
  purpose: string;
}

export function normalizeVerificationInput(input: {
  phone: unknown;
  purpose: unknown;
}): VerificationRequest {
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  if (!isValidPhone(phone)) throw new InvalidPhoneError();

  const raw = input.purpose;
  const purpose =
    raw === undefined || raw === null || raw === ""
      ? LEGACY_VERIFICATION_PURPOSE
      : raw;
  if (
    purpose !== LEGACY_VERIFICATION_PURPOSE &&
    !isVerificationPurpose(purpose)
  ) {
    throw new InvalidPurposeError();
  }
  return { phone, purpose: String(purpose) };
}

@Injectable()
export class PhoneVerificationService {
  private readonly authCodes;
  private smsInstance?: SmsProvider;

  constructor(prisma: PrismaService) {
    this.authCodes = createAuthRepo(prisma.client);
  }

  private get sms(): SmsProvider {
    if (!this.smsInstance) this.smsInstance = resolveSmsProvider();
    return this.smsInstance;
  }

  async issue(input: VerificationRequest & { ip: string }): Promise<void> {
    await requestSmsCode(
      { phone: input.phone, purpose: input.purpose, ip: input.ip },
      { db: this.authCodes, sms: this.sms },
    );
  }

  async verify(input: {
    phone: string;
    code: string;
    purposes: readonly string[];
  }): Promise<VerifiedPhoneCode> {
    const record = await this.authCodes.findActiveCode(
      input.phone,
      input.purposes,
    );
    if (!record) throw new CodeExpiredError();
    if (record.code !== input.code) {
      const attempts = await this.authCodes.incrementAttempts(record.id);
      if (attempts >= MAX_CODE_ATTEMPTS) {
        await this.authCodes.consumeCode(record.id);
        throw new CodeAttemptsExhaustedError();
      }
      throw new CodeWrongError(MAX_CODE_ATTEMPTS - attempts);
    }
    return { codeId: record.id };
  }

  async consume(verified: VerifiedPhoneCode): Promise<void> {
    if (!(await this.authCodes.consumeCode(verified.codeId))) {
      throw new CodeExpiredError();
    }
  }
}
