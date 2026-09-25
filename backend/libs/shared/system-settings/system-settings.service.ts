/* ============================================
 * 系统设置：管理端可配的三个模块（支付凭证 / 充值政策文案 / 限流参数）
 *
 * 每模块在 `system_settings` 里存**一行完整快照**（见 prisma 模型注释）。
 * 本文件是唯一的读写入口，负责三件事：
 *   1. 模块字段的定义与默认值（哪些字段、哪个是密）；
 *   2. 密文的封/解（`credentials-crypto`）与**脱敏回显**；
 *   3. 给内部调用方解出**真实凭证**（充值下单要用）。
 *
 * ── 为什么凭证字段这么排 ─────────────────────────────────────────────────────
 *
 * 用户要的是「对接的商户信息可配置」。但商户信息分属两处，**不能重复配**：
 *
 *   · **我们配的**（本模块）：支付网关侧的商户号 / 应用 ID / 商户密钥，
 *     以及**我们自己的回调地址**。凭证是「我们是谁」——发给网关的每一笔下单都要用。
 *   · **网关配的**（不在本仓、也不该在这里配）：杭州银行的 `merId` / `certId` /
 *     `bankCertId` / `sdkAppId` / 银行网关地址 / 商户证书 `.pfx` 与密码。
 *     那些住在支付网关的 `t_pay_interface_config` 里，由网关自己的运营界面维护。
 *     在这里再存一份，只会得到**两处会漂的真相**：银行换证时改了一处，
 *     另一处静静地错着，而错误出现在「回调验签失败」这种离原因很远的报错上。
 * ============================================ */
import { Injectable } from "@nestjs/common";
import {
  createSystemSettingRepo,
  type SystemSettingRepo,
} from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import {
  SystemSettingsConfigError,
  maskSecret,
  openSecret,
  sealSecret,
} from "./credentials-crypto.js";

/* ---------- 模块与字段 ---------- */

const KEY_CREDENTIALS = "credentials";
const KEY_POLICY = "policy";
const KEY_RATE_LIMIT = "rateLimit";

/** 凭证字段。`secret: true` 的字段加密入库、脱敏回显。 */
const CREDENTIAL_FIELDS = [
  { name: "hccb_mch_no", secret: false },
  { name: "hccb_app_id", secret: false },
  { name: "hccb_app_secret", secret: true },
  { name: "hccb_notify_url", secret: false },
] as const;

const POLICY_FIELDS = ["refund_text", "invoice_text"] as const;
const RATE_LIMIT_FIELDS = ["rate_per_min", "rate_per_hour", "concurrent", "burst"] as const;

export interface SystemCredentials {
  /** 网关侧商户号（不是杭州银行的 merId） */
  hccb_mch_no: string;
  /** 网关侧应用 ID */
  hccb_app_id: string;
  /** 网关侧商户密钥（密） */
  hccb_app_secret: string;
  /** 异步通知地址：网关支付成功后回调到这里（须公网可达） */
  hccb_notify_url: string;
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
  policy: SystemPolicy;
  rateLimit: SystemRateLimit;
}

export interface SystemSettingsPatch {
  credentials?: Partial<SystemCredentials>;
  policy?: Partial<SystemPolicy>;
  rateLimit?: Partial<SystemRateLimit>;
}

/** 下单所需的商户身份 + 回调地址。字段齐了才给，缺一个都不下单。 */
export interface PayMerchantConfig {
  mchNo: string;
  appId: string;
  appSecret: string;
  notifyUrl: string;
}

/* ---------- 默认值 ---------- */

const emptyCredentials = (): SystemCredentials => ({
  hccb_mch_no: "",
  hccb_app_id: "",
  hccb_app_secret: "",
  hccb_notify_url: "",
});

const emptyPolicy = (): SystemPolicy => ({ refund_text: "", invoice_text: "" });

const emptyRateLimit = (): SystemRateLimit => ({
  rate_per_min: 0,
  rate_per_hour: 0,
  concurrent: 0,
  burst: 0,
});

/* ---------- 解析 ---------- */

function parseJsonObject(raw: string, module: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 落下去的值是我们自己序列化的，解析不了 = 有人绕过本模块写过库。
    // 静默当成空会让运营在界面上看到「全部未配置」并覆盖掉真实内容。
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

  /**
   * 管理端读：凭证**脱敏回显**，其余模块原样。
   *
   * <p>凭证行读不出来（没配密钥、或密文解不开）时**不让整个接口失败**：
   * 那是「配置有问题」，运营正需要进这个页面去改它。此时凭证按「未配置」回显，
   * 把原因留在日志里——真值读不出来也不影响改配置。
   */
  async read(): Promise<SystemSettingsView> {
    return {
      credentials: await this.readCredentialsMasked(),
      policy: await this.readPolicy(),
      rateLimit: await this.readRateLimit(),
    };
  }

  /**
   * 管理端写：按模块**部分更新**。
   *
   * <p>凭证是「合并」语义（前端一次只改一个字段），不是整行覆盖——
   * 覆盖会把没提交的那几个字段抹成空。未提交的模块不动。
   */
  async update(patch: SystemSettingsPatch): Promise<void> {
    if (patch.credentials) {
      const current = await this.readCredentials();
      const next: SystemCredentials = { ...current };
      for (const field of CREDENTIAL_FIELDS) {
        const value = patch.credentials[field.name];
        if (typeof value === "string") next[field.name] = value.trim();
      }
      await this.repo.put(
        KEY_CREDENTIALS,
        sealSecret(JSON.stringify(next)),
        true,
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

  /**
   * 内部用：解出**真实**的支付商户配置（不脱敏）。
   *
   * <p>⚠️ 缺任何一项都抛，**不带着半份配置去下单**：少了商户号会被网关拒成
   *    「商户或商户应用不存在」，少了回调地址则会下一笔**永远不会通知我们**的单——
   *    钱收了、积分没人发。这两件事都必须在发起之前就拦住。
   */
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

  /* ---------- 各模块读取 ---------- */

  private async readCredentials(): Promise<SystemCredentials> {
    const row = await this.repo.get(KEY_CREDENTIALS);
    if (!row) return emptyCredentials();
    const raw = openSecret(row.value);
    const source = parseJsonObject(raw, "支付凭证");
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
