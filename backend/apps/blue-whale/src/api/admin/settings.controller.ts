import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import {
  SystemSettingsService,
  type SystemCredentials,
  type SystemPolicy,
  type SystemRateLimit,
  type SystemUpstream,
} from "@lib/shared/system-settings/index.js";

/**
 * 系统设置（管理端）。
 *
 * <p>四个模块共用一条接口（`GET/PUT /api/admin/settings`），按模块**部分更新**：
 * 一次只提交一个模块、甚至只提交该模块的一个字段。凭证是「合并」而不是覆盖——
 * 管理端一次只改一个字段，覆盖会把没提交的那几个抹成空。
 *
 * <p>⚠️ 凭证的**密文字段只回显脱敏值**（如 `****1234`），原值出不了这个接口。
 *    加密用的密钥在进程环境变量里（`SYSTEM_SETTINGS_SECRET`），不在库里——
 *    库与密钥分开放的，只看库读不出凭证。
 *
 * <p>⚠️ 这里配的是**我们发给支付网关的身份**（商户号/应用 ID/密钥/回调地址）。
 *    杭州银行那一侧的 `merId` / 证书 / 银行网关地址住在**支付网关自己的库**里，
 *    由网关的运营界面维护，不在这里配——两处各存一份只会得到会漂的两份真相。
 *
 * <p>⚠️ `upstream` 是**上游 new-api 的项目统一 key**（ADR-0114）：全项目共用这一把，
 *     backend 与 worker 都从这里取。`bwsvc_` 计费服务令牌**不在这里配**——那是服务身份，
 *     不是「我们发给上游的我们是谁」，见上游出口文件头。
 */
@Controller("admin/settings")
@UseGuards(AdminGuard)
export class AdminSettingsController {
  constructor(private readonly settings: SystemSettingsService) {}

  @Get()
  async read() {
    try {
      return { success: true, data: await this.settings.read() };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Put()
  async update(@Body() body: Record<string, unknown>) {
    const patch = parsePatch(body ?? {});
    try {
      await this.settings.update(patch);
      return { success: true, data: null };
    } catch (error) {
      throw toAdminError(error);
    }
  }
}

/* ---------- 入参解析 ---------- */

interface SettingsPatch {
  credentials?: Partial<SystemCredentials>;
  upstream?: Partial<SystemUpstream>;
  policy?: Partial<SystemPolicy>;
  rateLimit?: Partial<SystemRateLimit>;
}

/** 只接受已知模块与已知字段：一个拼错的字段名静默被存下来，会变成「配了但没生效」的工单。 */
function parsePatch(body: Record<string, unknown>): SettingsPatch {
  const patch: SettingsPatch = {};

  // 模块名同样要认。`upstream` 打成 `upstreams` 和字段名打错是同一类事故：
  // 请求 200 成功、界面显示已保存，而系统按「没配」拒绝每一个上游调用。
  rejectUnknownKeys(body, MODULE_KEYS, "settings");

  const credentials = body.credentials;
  if (credentials !== undefined) {
    const source = requireObject(credentials, "credentials");
    rejectUnknownKeys(source, CREDENTIAL_KEYS, "credentials");
    const next: Partial<SystemCredentials> = {};
    for (const key of CREDENTIAL_KEYS) {
      const value = source[key];
      if (value === undefined) continue;
      if (typeof value !== "string") {
        throw new AdminException(400, `credentials.${key} 须为字符串`);
      }
      next[key] = value;
    }
    patch.credentials = next;
  }

  const upstream = body.upstream;
  if (upstream !== undefined) {
    const source = requireObject(upstream, "upstream");
    rejectUnknownKeys(source, UPSTREAM_KEYS, "upstream");
    const next: Partial<SystemUpstream> = {};
    for (const key of UPSTREAM_KEYS) {
      const value = source[key];
      if (value === undefined) continue;
      if (typeof value !== "string") {
        throw new AdminException(400, `upstream.${key} 须为字符串`);
      }
      next[key] = value;
    }
    patch.upstream = next;
  }

  const policy = body.policy;
  if (policy !== undefined) {
    const source = requireObject(policy, "policy");
    rejectUnknownKeys(source, POLICY_KEYS, "policy");
    patch.policy = {
      ...readOptionalString(source, "refund_text"),
      ...readOptionalString(source, "invoice_text"),
    };
  }

  const rateLimit = body.rateLimit;
  if (rateLimit !== undefined) {
    const source = requireObject(rateLimit, "rateLimit");
    rejectUnknownKeys(source, RATE_LIMIT_KEYS, "rateLimit");
    patch.rateLimit = {
      ...readOptionalPositive(source, "rate_per_min"),
      ...readOptionalPositive(source, "rate_per_hour"),
      ...readOptionalPositive(source, "concurrent"),
      ...readOptionalPositive(source, "burst"),
    };
  }

  return patch;
}

const CREDENTIAL_KEYS = [
  "hccb_mch_no",
  "hccb_app_id",
  "hccb_app_secret",
  "hccb_notify_url",
] as const satisfies readonly (keyof SystemCredentials)[];
const UPSTREAM_KEYS = ["new_api_key"] as const satisfies readonly (keyof SystemUpstream)[];
const MODULE_KEYS = ["credentials", "upstream", "policy", "rateLimit"] as const;
const POLICY_KEYS = ["refund_text", "invoice_text"] as const satisfies readonly (keyof SystemPolicy)[];
const RATE_LIMIT_KEYS = [
  "rate_per_min",
  "rate_per_hour",
  "concurrent",
  "burst",
] as const satisfies readonly (keyof SystemRateLimit)[];

function requireObject(value: unknown, module: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminException(400, `${module} 须为对象`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  source: Record<string, unknown>,
  known: readonly string[],
  module: string,
): void {
  for (const key of Object.keys(source)) {
    if (!known.includes(key)) {
      throw new AdminException(400, `${module} 不认识的字段：${key}`);
    }
  }
}

function readOptionalString(
  source: Record<string, unknown>,
  key: keyof SystemPolicy,
): Partial<SystemPolicy> {
  const value = source[key];
  if (value === undefined) return {};
  if (typeof value !== "string") throw new AdminException(400, `${key} 须为字符串`);
  return { [key]: value };
}

function readOptionalPositive(
  source: Record<string, unknown>,
  key: keyof SystemRateLimit,
): Partial<SystemRateLimit> {
  const value = source[key];
  if (value === undefined) return {};
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new AdminException(400, `${key} 须为大于 0 的数值`);
  }
  return { [key]: value };
}
