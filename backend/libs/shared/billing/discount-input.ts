/* ============================================
 * 折扣写请求的**形状**解析（会员折扣 / 营销活动）
 *
 * ── 这一层为什么只校验形状，不校验语义 ─────────────────────────────────────────
 *
 * 语义校验（万分比范围、等级枚举、时间窗、模式通配符、时区名）**全在 billing**
 * （`DiscountRules`）。在这里再实现一遍，等于把同一套规则抄第二份 ——
 * 抄漏一条就会出现「这里放行、那边拒绝」，或者更糟的「两边都放行但结果不同」。
 * billing 的报错还带得出是**哪一列**不合法，那是唯一有资格回答这个问题的进程。
 *
 * 那这一层负责什么：把 `unknown` 变成**有类型的输入**。没有它，一个
 * `{"discountBp": "9000"}`（字符串）会原样转发，billing 反序列化失败后回一句
 * 关于 Jackson 的错，运营看到的是「请求体不是合法的 JSON 或字段类型不匹配」——
 * 而真正的问题是界面上那个框填错了类型。
 *
 * ⚠️ `null` 与「没给」在这里是**两件事**：`null` = 不限 / 全天（明确的状态），
 *    没给 = 调用方漏了。混同之后，一次漏字段的保存会把「限 3 个模型」悄悄改成「不限」。
 * ============================================ */
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

/** 请求体不合法（形状层面）。控制器映射成 400 —— 是**改表单**，不是等服务恢复。 */
export class DiscountInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscountInputError";
  }
}

/**
 * 路径参数 → 正的整数 id。
 *
 * <p>非数字是 400（改 URL）而不是 500：`/admin/billing-discounts/abc` 是调用方拼错了地址，
 * 让运维去查一个没坏的服务是误导。
 */
export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AdminException(400, `id 必须是正整数：${raw}`);
  }
  return id;
}

/**
 * 折扣接口的失败分类 → 管理端 HTTP 语义（两个折扣控制器共用一份）。
 *
 * <p>**四类的处置方向不同，不能压成一个 500**：
 * 填错了 / 被 billing 拒了是 400（改表单）、目标已被删是 404（刷新）、
 * 地址没配或 billing 不可用是 503（改配置 / 等服务）。
 * 抄成两份的话，迟早有一个控制器漏掉一类，而漏掉的表现是「同一个错误在两个页面
 * 给出不同的状态码」——那时按码写告警规则就没法做了。
 */
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

/** 会员折扣的写请求体。 */
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

/** 活动的写请求体。 */
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

/* ---------- 原语：全部只做类型与存在性判断 ---------- */

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

/** 可空文本：`null` 与空串都归一成 `null`（= 不限 / 全天）。 */
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
  // ⚠️ 空数组在 billing 侧会被归一成 NULL（= 不限）。这里先归一，让「不限」在
  //    两个进程里是同一个值 —— 否则「界面上清空了」这件事要靠读 billing 的代码才知道
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
