import { Injectable } from "@nestjs/common";
import {
  createSystemSettingRepo,
  type SystemSettingRepo,
} from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { UpstreamCredentialMissingError } from "@lib/shared/upstream/new-api-egress.js";
import {
  SystemSettingsConfigError,
  maskSecret,
  openSecret,
  sealSecret,
} from "./credentials-crypto.js";


const KEY_CREDENTIALS = "credentials";
const KEY_UPSTREAM = "upstream";
const KEY_POLICY = "policy";
const KEY_RATE_LIMIT = "rateLimit";

const CREDENTIAL_FIELDS = [
  { name: "hccb_mch_no", secret: false },
  { name: "hccb_app_id", secret: false },
  { name: "hccb_app_secret", secret: true },
  { name: "hccb_notify_url", secret: false },
] as const;

const UPSTREAM_FIELDS = [{ name: "new_api_key", secret: true }] as const;

const POLICY_FIELDS = ["refund_text", "invoice_text"] as const;
const RATE_LIMIT_FIELDS = ["rate_per_min", "rate_per_hour", "concurrent", "burst"] as const;

export interface SystemCredentials {
  hccb_mch_no: string;
  hccb_app_id: string;
  hccb_app_secret: string;
  hccb_notify_url: string;
}

export interface SystemUpstream {
  new_api_key: string;
}

export interface SystemPolicy {
  refund_text: string;
  invoice_text: string;
}

export interface SystemRateLimit {
  rate_per_min: number;
  rate_per_hour: number;
  concurrent: number;
  burst: number;
}

export interface SystemSettingsView {
  credentials: SystemCredentials;
  upstream: SystemUpstream;
  policy: SystemPolicy;
  rateLimit: SystemRateLimit;
}

export interface SystemSettingsPatch {
  credentials?: Partial<SystemCredentials>;
  upstream?: Partial<SystemUpstream>;
  policy?: Partial<SystemPolicy>;
  rateLimit?: Partial<SystemRateLimit>;
}

export interface PayMerchantConfig {
  mchNo: string;
  appId: string;
  appSecret: string;
  notifyUrl: string;
}


const emptyCredentials = (): SystemCredentials => ({
  hccb_mch_no: "",
  hccb_app_id: "",
  hccb_app_secret: "",
  hccb_notify_url: "",
});

const emptyPolicy = (): SystemPolicy => ({ refund_text: "", invoice_text: "" });

const emptyUpstream = (): SystemUpstream => ({ new_api_key: "" });

const emptyRateLimit = (): SystemRateLimit => ({
  rate_per_min: 0,
  rate_per_hour: 0,
  concurrent: 0,
  burst: 0,
});


function parseJsonObject(raw: string, module: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
  }
  throw new SystemSettingsConfigError(`${module} 配置不是合法的 JSON 对象，请人工核对`);
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function readPositiveNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function isMaskedEcho(submitted: string, current: string): boolean {
  return current !== "" && submitted === maskSecret(current);
}

@Injectable()
export class SystemSettingsService {
  private repoInstance?: SystemSettingRepo;

  private get repo(): SystemSettingRepo {
    if (!this.repoInstance) {
      this.repoInstance = createSystemSettingRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  async read(): Promise<SystemSettingsView> {
    return {
      credentials: await this.readCredentialsMasked(),
      upstream: await this.readUpstreamMasked(),
      policy: await this.readPolicy(),
      rateLimit: await this.readRateLimit(),
    };
  }

  async update(patch: SystemSettingsPatch): Promise<void> {
    if (patch.credentials) {
      await this.mergeSecrets(
        KEY_CREDENTIALS,
        CREDENTIAL_FIELDS,
        await this.readCredentials(),
        patch.credentials,
      );
    }

    if (patch.upstream) {
      await this.mergeSecrets(
        KEY_UPSTREAM,
        UPSTREAM_FIELDS,
        await this.readUpstream(),
        patch.upstream,
      );
    }

    if (patch.policy) {
      const current = await this.readPolicy();
      const next: SystemPolicy = {
        refund_text: patch.policy.refund_text ?? current.refund_text,
        invoice_text: patch.policy.invoice_text ?? current.invoice_text,
      };
      await this.repo.put(KEY_POLICY, JSON.stringify(next), false);
    }

    if (patch.rateLimit) {
      const current = await this.readRateLimit();
      const next: SystemRateLimit = {
        rate_per_min: patch.rateLimit.rate_per_min ?? current.rate_per_min,
        rate_per_hour: patch.rateLimit.rate_per_hour ?? current.rate_per_hour,
        concurrent: patch.rateLimit.concurrent ?? current.concurrent,
        burst: patch.rateLimit.burst ?? current.burst,
      };
      await this.repo.put(KEY_RATE_LIMIT, JSON.stringify(next), false);
    }
  }

  async requirePayMerchantConfig(): Promise<PayMerchantConfig> {
    const credentials = await this.readCredentials();
    const missing = CREDENTIAL_FIELDS.filter((f) => !credentials[f.name]).map((f) => f.name);
    if (missing.length > 0) {
      throw new SystemSettingsConfigError(
        `支付商户信息未配置完整（缺 ${missing.join(" / ")}）：请在管理端「系统设置 → 支付凭证」补齐`,
      );
    }
    return {
      mchNo: credentials.hccb_mch_no,
      appId: credentials.hccb_app_id,
      appSecret: credentials.hccb_app_secret,
      notifyUrl: credentials.hccb_notify_url,
    };
  }

  async requireUpstreamKey(): Promise<string> {
    const upstream = await this.readUpstream();
    if (!upstream.new_api_key) {
      throw new UpstreamCredentialMissingError();
    }
    return upstream.new_api_key;
  }


  private async mergeSecrets<K extends string>(
    key: string,
    fields: readonly { name: K; secret: boolean }[],
    current: Record<K, string>,
    submitted: Partial<Record<K, string>>,
  ): Promise<void> {
    const next: Record<K, string> = { ...current };
    for (const field of fields) {
      const value = submitted[field.name];
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (field.secret && isMaskedEcho(trimmed, next[field.name])) continue;
      next[field.name] = trimmed;
    }
    await this.repo.put(key, sealSecret(JSON.stringify(next)), true);
  }

  private async readSecretSource(key: string, label: string): Promise<Record<string, unknown>> {
    const row = await this.repo.get(key);
    if (!row) return {};
    return parseJsonObject(openSecret(row.value), label);
  }

  private async readCredentials(): Promise<SystemCredentials> {
    const source = await this.readSecretSource(KEY_CREDENTIALS, "支付凭证");
    const result = emptyCredentials();
    for (const field of CREDENTIAL_FIELDS) {
      result[field.name] = readString(source, field.name);
    }
    return result;
  }

  private async readCredentialsMasked(): Promise<SystemCredentials> {
    try {
      const raw = await this.readCredentials();
      const masked = emptyCredentials();
      for (const field of CREDENTIAL_FIELDS) {
        masked[field.name] = field.secret ? maskSecret(raw[field.name]) : raw[field.name];
      }
      return masked;
    } catch {
      return emptyCredentials();
    }
  }

  private async readUpstream(): Promise<SystemUpstream> {
    const source = await this.readSecretSource(KEY_UPSTREAM, "上游凭证");
    const result = emptyUpstream();
    for (const field of UPSTREAM_FIELDS) {
      result[field.name] = readString(source, field.name);
    }
    return result;
  }

  private async readUpstreamMasked(): Promise<SystemUpstream> {
    try {
      const raw = await this.readUpstream();
      const masked = emptyUpstream();
      for (const field of UPSTREAM_FIELDS) {
        masked[field.name] = field.secret ? maskSecret(raw[field.name]) : raw[field.name];
      }
      return masked;
    } catch {
      return emptyUpstream();
    }
  }

  private async readPolicy(): Promise<SystemPolicy> {
    const row = await this.repo.get(KEY_POLICY);
    if (!row) return emptyPolicy();
    const source = parseJsonObject(row.value, "充值政策文案");
    const result = emptyPolicy();
    for (const field of POLICY_FIELDS) {
      result[field] = readString(source, field);
    }
    return result;
  }

  private async readRateLimit(): Promise<SystemRateLimit> {
    const row = await this.repo.get(KEY_RATE_LIMIT);
    if (!row) return emptyRateLimit();
    const source = parseJsonObject(row.value, "限流配置");
    const result = emptyRateLimit();
    for (const field of RATE_LIMIT_FIELDS) {
      result[field] = readPositiveNumber(source, field);
    }
    return result;
  }
}
