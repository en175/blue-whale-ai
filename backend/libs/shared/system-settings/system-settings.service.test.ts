import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SYSTEM_SETTINGS_SECRET_ENV,
  SystemSettingsConfigError,
  maskSecret,
} from "./credentials-crypto.js";
import { SystemSettingsService } from "./system-settings.service.js";

/** 内存假 Prisma：只实现 system_settings 的两个方法（够 system-settings 用）。 */
function makePrisma() {
  const rows = new Map<string, Record<string, unknown>>();
  const prisma = {
    system_settings: {
      findUnique: async ({ where }: { where: { setting_key: string } }) =>
        rows.get(where.setting_key) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { setting_key: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = rows.get(where.setting_key);
        if (existing) Object.assign(existing, update);
        else rows.set(where.setting_key, { ...create });
        return rows.get(where.setting_key);
      },
    },
  };
  return { prisma, rows };
}

const KEY = "b".repeat(64);

function serviceWith(rows?: Map<string, Record<string, unknown>>) {
  const made = rows ? { rows } : makePrisma();
  const prisma = {
    system_settings: {
      findUnique: async ({ where }: { where: { setting_key: string } }) =>
        made.rows.get(where.setting_key) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { setting_key: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = made.rows.get(where.setting_key);
        if (existing) Object.assign(existing, update);
        else made.rows.set(where.setting_key, { ...create });
        return made.rows.get(where.setting_key);
      },
    },
  };
  return {
    service: new SystemSettingsService({ client: prisma } as never),
    rows: made.rows,
  };
}

describe("SystemSettingsService — 支付凭证", () => {
  beforeEach(() => {
    process.env[SYSTEM_SETTINGS_SECRET_ENV] = KEY;
  });
  afterEach(() => {
    delete process.env[SYSTEM_SETTINGS_SECRET_ENV];
  });

  it("凭证以密文入库：库里读不到明文，接口回显脱敏值", async () => {
    const { service, rows } = serviceWith();
    await service.update({
      credentials: {
        hccb_mch_no: "M0001",
        hccb_app_id: "app-1",
        hccb_app_secret: "super-secret-value",
        hccb_notify_url: "https://api.example.com/api/recharge/notify/pay",
      },
    });

    const stored = String(rows.get("credentials")?.setting_value ?? "");
    expect(rows.get("credentials")?.is_secret).toBe(true);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain("super-secret-value");
    expect(stored).not.toContain("M0001");

    const view = await service.read();
    // 非密字段明文回显（把商户号打成 **** 是错的：运营核对不了）
    expect(view.credentials.hccb_mch_no).toBe("M0001");
    expect(view.credentials.hccb_app_id).toBe("app-1");
    expect(view.credentials.hccb_notify_url).toBe(
      "https://api.example.com/api/recharge/notify/pay",
    );
    // 密字段只给尾 4 位
    expect(view.credentials.hccb_app_secret).toBe(maskSecret("super-secret-value"));
    expect(view.credentials.hccb_app_secret).not.toContain("super");
    // 内部读取能拿到真值（下单要用）
    const config = await service.requirePayMerchantConfig();
    expect(config.appSecret).toBe("super-secret-value");
  });

  it("部分更新是「合并」：改一个字段不会把别的抹成空", async () => {
    const { service } = serviceWith();
    await service.update({
      credentials: {
        hccb_mch_no: "M0001",
        hccb_app_id: "app-1",
        hccb_app_secret: "sec",
        hccb_notify_url: "https://api.example.com/notify",
      },
    });
    await service.update({ credentials: { hccb_app_id: "app-2" } });

    const config = await service.requirePayMerchantConfig();
    expect(config.appId).toBe("app-2");
    expect(config.mchNo).toBe("M0001");
    expect(config.appSecret).toBe("sec");
    expect(config.notifyUrl).toBe("https://api.example.com/notify");
  });

  it("缺密钥时不写也不读凭证（fail closed，不降级成明文）", async () => {
    delete process.env[SYSTEM_SETTINGS_SECRET_ENV];
    const { service, rows } = serviceWith();
    await expect(
      service.update({ credentials: { hccb_mch_no: "M0001" } }),
    ).rejects.toThrow(SystemSettingsConfigError);
    expect(rows.size).toBe(0);
  });

  it("凭证缺项 → 拒绝给出配置（不带着半份配置去下单）", async () => {
    const { service } = serviceWith();
    await service.update({ credentials: { hccb_mch_no: "M0001" } });
    await expect(service.requirePayMerchantConfig()).rejects.toThrow(
      /支付商户信息未配置完整/,
    );
  });

  it("密文解不开（换了密钥 / 被改过）→ 回显按「未配置」，进页面改配置不被拦住", async () => {
    const { service, rows } = serviceWith();
    await service.update({ credentials: { hccb_mch_no: "M0001", hccb_app_secret: "sec" } });
    rows.get("credentials")!.setting_value = "v1.AAAA.BBBB.CCCC";

    const view = await service.read();
    expect(view.credentials).toEqual({
      hccb_mch_no: "",
      hccb_app_id: "",
      hccb_app_secret: "",
      hccb_notify_url: "",
    });
  });

  it("非密模块（政策文案 / 限流）明文存储并原样读回", async () => {
    const { service, rows } = serviceWith();
    await service.update({
      policy: { refund_text: "7 天内可退", invoice_text: "联系客服开票" },
      rateLimit: { rate_per_min: 60, rate_per_hour: 1000, concurrent: 5, burst: 2 },
    });

    expect(rows.get("policy")?.is_secret).toBe(false);
    const view = await service.read();
    expect(view.policy).toEqual({ refund_text: "7 天内可退", invoice_text: "联系客服开票" });
    expect(view.rateLimit).toEqual({
      rate_per_min: 60,
      rate_per_hour: 1000,
      concurrent: 5,
      burst: 2,
    });
  });
});

describe("maskSecret", () => {
  it("留尾 4 位；空值保持空串；短值全星", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret("ab")).toBe("****");
    expect(maskSecret("abcd")).toBe("****");
    expect(maskSecret("abcdefgh")).toBe("****efgh");
  });
});
