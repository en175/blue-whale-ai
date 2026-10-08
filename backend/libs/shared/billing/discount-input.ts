import type {
  MemberDiscountInput,
  PromotionInput,
} from "@lib/shared/billing/billing-admin-client.js";
import {
  BillingAdminConfigError,
  BillingAdminError,
  DiscountNotFoundError,
  DiscountRejectedError,
} from "@lib/shared/billing/billing-admin-client.js";
import { AdminException } from "@lib/shared/errors/admin-error.js";

export class DiscountInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscountInputError";
  }
}

export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AdminException(400, `id 必须是正整数：${raw}`);
  }
  return id;
}

export function toDiscountAdminError(error: unknown): AdminException {
  if (error instanceof AdminException) return error;
  if (error instanceof DiscountInputError || error instanceof DiscountRejectedError) {
    return new AdminException(400, error.message);
  }
  if (error instanceof DiscountNotFoundError) return new AdminException(404, error.message);
  if (error instanceof BillingAdminConfigError || error instanceof BillingAdminError) {
    return new AdminException(503, error.message);
  }
  return new AdminException(500, error instanceof Error ? error.message : "未知错误");
}

export function parseMemberDiscountInput(body: unknown): MemberDiscountInput {
  const raw = asObject(body);
  return {
    tier: requireText(raw, "tier", "会员等级"),
    modelPattern: requireText(raw, "modelPattern", "模型匹配"),
    taskPattern: requireText(raw, "taskPattern", "任务匹配"),
    discountBp: requireInt(raw, "discountBp", "折扣"),
    priority: requireInt(raw, "priority", "优先级"),
    status: requireText(raw, "status", "状态"),
  };
}

export function parsePromotionInput(body: unknown): PromotionInput {
  const raw = asObject(body);
  return {
    code: requireText(raw, "code", "活动标识"),
    name: requireText(raw, "name", "活动名称"),
    discountBp: requireInt(raw, "discountBp", "折扣"),
    modelIds: requireTextArray(raw, "modelIds", "模型范围"),
    taskTypes: optionalTextArray(raw, "taskTypes", "任务类型范围"),
    tierScope: optionalTextArray(raw, "tierScope", "适用等级"),
    startAt: requireText(raw, "startAt", "起始时间"),
    endAt: requireText(raw, "endAt", "结束时间"),
    dailyTimeStart: optionalText(raw, "dailyTimeStart", "每日时段起"),
    dailyTimeEnd: optionalText(raw, "dailyTimeEnd", "每日时段止"),
    daysOfWeek: optionalIntArray(raw, "daysOfWeek", "生效星期"),
    tz: requireText(raw, "tz", "时区"),
    status: requireText(raw, "status", "状态"),
    priority: requireInt(raw, "priority", "优先级"),
  };
}


function asObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new DiscountInputError("请求体必须是一个 JSON 对象");
  }
  return body as Record<string, unknown>;
}

function requireText(raw: Record<string, unknown>, key: string, label: string): string {
  const value = raw[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new DiscountInputError(`${label}必填`);
  }
  return value.trim();
}

function requireInt(raw: Record<string, unknown>, key: string, label: string): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new DiscountInputError(`${label}必须是整数`);
  }
  return value;
}

function optionalText(raw: Record<string, unknown>, key: string, label: string): string | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new DiscountInputError(`${label}必须是文本`);
  return value.trim() || null;
}

function requireTextArray(raw: Record<string, unknown>, key: string, label: string): string[] {
  const values = textArray(raw, key, label);
  if (values === null || values.length === 0) {
    throw new DiscountInputError(`${label}至少填一个（全部填 * ）`);
  }
  return values;
}

function optionalTextArray(raw: Record<string, unknown>, key: string, label: string): string[] | null {
  const values = textArray(raw, key, label);
  return values === null || values.length === 0 ? null : values;
}

function textArray(raw: Record<string, unknown>, key: string, label: string): string[] | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new DiscountInputError(`${label}必须是文本数组`);
  }
  return (value as string[]).map((item) => item.trim()).filter((item) => item !== "");
}

function optionalIntArray(raw: Record<string, unknown>, key: string, label: string): number[] | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item))) {
    throw new DiscountInputError(`${label}必须是整数数组`);
  }
  const values = value as number[];
  return values.length === 0 ? null : values;
}
