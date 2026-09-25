/* ============================================
 * 系统设置：管理端可配的四个模块（支付凭证 / 上游凭证 / 充值政策文案 / 限流参数）
 *
 * 每模块在 `system_settings` 里存**一行完整快照**（见 prisma 模型注释）。
 * 本文件是唯一的读写入口，负责三件事：
 *   1. 模块字段的定义与默认值（哪些字段、哪个是密）；
 *   2. 密文的封/解（`credentials-crypto`）与**脱敏回显**；
 *   3. 给内部调用方解出**真实凭证**（充值下单、打 new-api 都要用）。
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
 *
 * ── 上游凭证为什么也在这里（而不是留在环境变量） ─────────────────────────────
 *
 * new-api 的统一 key 原来走 `NEW_API_UPSTREAM_KEY` 环境变量，于是「换一把 key」
 * 等于「改部署、重启全项目」。用户的口径是「整个项目调用 newapi 共用这一个配置」——
 * 那就得有一个**改完即生效、且全项目只有一份**的地方，而不是三份 env 各配一次。
 * 落点选在本模块而非另起一套：加密（AES-256-GCM）、脱敏回显、按模块合并三件事
 * 这里都已经有了，再开一套只会得到两套会漂的真相。
 * ============================================ */
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

/* ---------- 模块与字段 ---------- */

const KEY_CREDENTIALS = "credentials";
const KEY_UPSTREAM = "upstream";
const KEY_POLICY = "policy";
const KEY_RATE_LIMIT = "rateLimit";

/** 凭证字段。`secret: true` 的字段加密入库、脱敏回显。 */
const CREDENTIAL_FIELDS = [
  { name: "hccb_mch_no", secret: false },
  { name: "hccb_app_id", secret: false },
  { name: "hccb_app_secret", secret: true },
  { name: "hccb_notify_url", secret: false },
] as const;

/**
 * 上游（new-api）凭证字段。**只有这一把**——项目里所有以「蓝鲸自己」身份打
 * new-api 的调用都用它（登录后回注请求头、技能格式化、worker 的素材跟进）。
 *
 * <p>⚠️ 与它并列的 `bwsvc_` 服务令牌**不在这里配、也不该并进来**：那是 Agent 计费面的
 * **服务身份**，走 new-api 另外一套鉴权模型（按前缀分流），换成统一 key 会静默把账
 * 记到别人头上。见 `libs/shared/upstream/new-api-egress.ts` 文件头。
 */
const UPSTREAM_FIELDS = [{ name: "new_api_key", secret: true }] as const;

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

/** 上游（new-api）项目级统一 key。 */
export interface SystemUpstream {
  /** 项目统一 key（密）：所有以「蓝鲸自己」身份打 new-api 的调用都用它 */
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

const emptyUpstream = (): SystemUpstream => ({ new_api_key: "" });

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

/**
 * 提交值是不是**当前真值的脱敏回显**（而不是用户敲进去的新值）。
 *
 * <p>密字段对外只回显 `****1234`。管理端若把回显原样 PUT 回来，「合并语义」会把它
 * 当新值存进去——真凭证就此变成一串星号，而且**当场看不出来**：要等到下一次用它
 * 鉴权才炸，报错点离原因很远。命中回显一律按「这次没改这个字段」处理。
 */
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
      upstream: await this.readUpstreamMasked(),
      policy: await this.readPolicy(),
      rateLimit: await this.readRateLimit(),
    };
  }

  /**
   * 管理端写：按模块**部分更新**。
   *
   * <p>凭证是「合并」语义（前端一次只改一个字段），不是整行覆盖——
   * 覆盖会把没提交的那几个字段抹成空。未提交的模块不动。
   *
   * <p>密字段额外过滤**脱敏回显被原样提交回来**的情况（见 {@link isMaskedEcho}）。
   */
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

  /**
   * 内部用：解出**真实**的上游统一 key（不脱敏）。
   *
   * <p>⚠️ 拿不到就抛 {@link UpstreamCredentialMissingError}（503 +
   *    `upstream_credential_missing`），**绝不返回空串**。空串打上游的表现是
   *    `Authorization: Bearer `，上游回一个 401，而报错点离原因（管理端没配）很远——
   *    这正是出口文件头点名过的「空串陷阱」。
   *
   * <p>⚠️ **每次调用都现查库**，进程内不缓存。调用点都是控制面路径——AuthGuard 每请求回注、
   *    技能格式化——而缓存买到的是「改了配置不生效」：多副本部署下没有一条不存在的广播
   *    通道能去让它失效。库是唯一真相，就没有这个问题。（worker-java 侧同口径，
   *    见 `SystemSettingMapper` 与 `UpstreamCredential.requireKey`。）
   */
  async requireUpstreamKey(): Promise<string> {
    const upstream = await this.readUpstream();
    if (!upstream.new_api_key) {
      throw new UpstreamCredentialMissingError();
    }
    return upstream.new_api_key;
  }

  /* ---------- 各模块读取 ---------- */

  /**
   * 密模块的合并写：读回**真值** → 逐字段并入提交值 → 整行加密回写。
   *
   * <p>支付凭证与上游凭证共用这一份实现：于是「哪些字段是密的」「脱敏回显不算新值」
   * 只有一处口径，不会一个模块修了、另一个模块还踩着同一个坑。
   *
   * @param current 当前真值（由调用方用对应的强类型 reader 读出，读不到即为全空）
   */
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

  /** 读一个密模块的 JSON 原文（已解密）。行不存在 = 全未配置。 */
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

  /** 上游凭证的脱敏回显。读不出来（未配密钥 / 密文解不开）时按「未配置」回显——
   *  与支付凭证同口径：配置有问题时运营正需要进这个页面去改它。 */
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
