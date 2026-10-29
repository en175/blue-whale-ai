import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SYSTEM_SETTINGS_SECRET_ENV,
  SystemSettingsConfigError,
  maskSecret,
} from "./credentials-crypto.js";
import { SystemSettingsService } from "./system-settings.service.js";
import { UpstreamCredentialMissingError } from "@lib/shared/upstream/new-api-egress.js";

function makePrisma() {
  const rows = new Map<string, Record<string, unknown>>();
  const prisma = {
    bw_platform_settings: {
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
    bw_platform_settings: {
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
    expect(view.credentials.hccb_mch_no).toBe("M0001");
    expect(view.credentials.hccb_app_id).toBe("app-1");
    expect(view.credentials.hccb_notify_url).toBe(
      "https://api.example.com/api/recharge/notify/pay",
    );
    expect(view.credentials.hccb_app_secret).toBe(maskSecret("super-secret-value"));
    expect(view.credentials.hccb_app_secret).not.toContain("super");
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


describe("SystemSettingsService — 上游凭证（new-api 项目统一 key）", () => {
  beforeEach(() => {
    process.env[SYSTEM_SETTINGS_SECRET_ENV] = KEY;
  });
  afterEach(() => {
    delete process.env[SYSTEM_SETTINGS_SECRET_ENV];
  });

  it("以密文入库：库里查不到明文，管理端只回显脱敏值", async () => {
    const { service, rows } = serviceWith();
    await service.update({ upstream: { new_api_key: "sk-fake-live-key-1234" } });

    const stored = rows.get("upstream")!;
    expect(stored.is_secret).toBe(true);
    expect(String(stored.setting_value)).not.toContain("sk-fake-live-key-1234");

    const view = await service.read();
    expect(view.upstream.new_api_key).toBe("****1234");
  });

  it("★ 配了 → 取到真值（全项目共用这一把）", async () => {
    const { service } = serviceWith();
    await service.update({ upstream: { new_api_key: "  sk-fake-live-key-1234  " } });

    expect(await service.requireUpstreamKey()).toBe("sk-fake-live-key-1234");
  });

  it("★ 没配 → 明确拒绝，**不是空串**（空串打上游只会收一个来路不明的 401）", async () => {
    const { service } = serviceWith();
    await expect(service.requireUpstreamKey()).rejects.toBeInstanceOf(
      UpstreamCredentialMissingError,
    );
    await expect(service.requireUpstreamKey()).rejects.toMatchObject({
      status: 503,
      code: "upstream_credential_missing",
    });
  });

  it("只填空格也算没配", async () => {
    const { service } = serviceWith();
    await service.update({ upstream: { new_api_key: "   " } });
    await expect(service.requireUpstreamKey()).rejects.toBeInstanceOf(
      UpstreamCredentialMissingError,
    );
  });

  it("★ 改配置 → 立即生效（读点现查库，进程内不缓存）", async () => {
    const { service } = serviceWith();
    await service.update({ upstream: { new_api_key: "sk-fake-before-1" } });
    expect(await service.requireUpstreamKey()).toBe("sk-fake-before-1");

    await service.update({ upstream: { new_api_key: "sk-fake-after-2" } });
    expect(await service.requireUpstreamKey()).toBe("sk-fake-after-2");
  });

  it("★ 脱敏回显被原样提交回来 → 当「没改」，真值不被 `****1234` 覆盖", async () => {
    const { service, rows } = serviceWith();
    await service.update({ upstream: { new_api_key: "sk-fake-live-key-1234" } });

    const view = await service.read();
    expect(view.upstream.new_api_key).toBe("****1234");
    await service.update({ upstream: { new_api_key: view.upstream.new_api_key } });

    expect(await service.requireUpstreamKey()).toBe("sk-fake-live-key-1234");
    expect(rows.get("upstream")!.is_secret).toBe(true);
  });

  it("同一坑在支付凭证上同样被挡住（一份实现，两个模块都受益）", async () => {
    const { service } = serviceWith();
    await service.update({
      credentials: {
        hccb_mch_no: "M1",
        hccb_app_id: "app-1",
        hccb_app_secret: "super-secret-value",
        hccb_notify_url: "https://api.example.com/notify",
      },
    });

    const view = await service.read();
    expect(view.credentials.hccb_app_secret).toBe("****alue");
    await service.update({ credentials: { hccb_app_secret: view.credentials.hccb_app_secret } });

    expect((await service.requirePayMerchantConfig()).appSecret).toBe("super-secret-value");
  });

  it("真·新值与回显恰好同形时不误判：值本来就短/以星号开头，照样能改", async () => {
    const { service } = serviceWith();
    await service.update({ upstream: { new_api_key: "sk-aaaa-1111" } });
    await service.update({ upstream: { new_api_key: "sk-bbbb-2222" } });
    expect(await service.requireUpstreamKey()).toBe("sk-bbbb-2222");
  });

  it("改上游凭证不影响支付凭证（按模块隔离）", async () => {
    const { service } = serviceWith();
    await service.update({
      credentials: { hccb_mch_no: "M1", hccb_app_id: "a", hccb_app_secret: "s", hccb_notify_url: "u" },
    });
    await service.update({ upstream: { new_api_key: "sk-fake-x" } });

    expect((await service.requirePayMerchantConfig()).mchNo).toBe("M1");
    expect(await service.requireUpstreamKey()).toBe("sk-fake-x");
  });

  it("缺主密钥时不写也不读上游凭证（fail closed，不降级成明文）", async () => {
    delete process.env[SYSTEM_SETTINGS_SECRET_ENV];
    const { service, rows } = serviceWith();
    await expect(
      service.update({ upstream: { new_api_key: "sk-fake-x" } }),
    ).rejects.toThrow(SystemSettingsConfigError);
    expect(rows.size).toBe(0);
  });

  it("密文解不开 → 读点抛（不退化成「未配置」：那会把运维指去管理端，而问题在部署）", async () => {
    const { service, rows } = serviceWith();
    await service.update({ upstream: { new_api_key: "sk-fake-x" } });
    rows.get("upstream")!.setting_value = "v1.AAAA.BBBB.CCCC";

    await expect(service.requireUpstreamKey()).rejects.toThrow(SystemSettingsConfigError);
    expect((await service.read()).upstream.new_api_key).toBe("");
  });
});

describe("SystemSettingsService — 生成水印（全项目唯一开关）", () => {
  it("缺行 → 默认关闭", async () => {
    const { service } = serviceWith();
    await expect(service.read()).resolves.toMatchObject({
      watermark: { enabled: false },
    });
  });

  it("★ 打开后明文入库，读点立即看到 true", async () => {
    const { service, rows } = serviceWith();
    await service.update({ watermark: { enabled: true } });

    expect(rows.get("watermark")?.is_secret).toBe(false);
    expect(JSON.parse(String(rows.get("watermark")?.setting_value))).toEqual({ enabled: true });
    await expect(service.read()).resolves.toMatchObject({
      watermark: { enabled: true },
    });
  });

  it("★ 再次关闭 → 回读 false；不传字段时保持当前值", async () => {
    const { service } = serviceWith();
    await service.update({ watermark: { enabled: true } });
    await service.update({ watermark: {} });
    await expect(service.read()).resolves.toMatchObject({
      watermark: { enabled: true },
    });

    await service.update({ watermark: { enabled: false } });
    await expect(service.read()).resolves.toMatchObject({
      watermark: { enabled: false },
    });
  });

  it("改水印不影响其他模块", async () => {
    const { service } = serviceWith();
    await service.update({ policy: { refund_text: "7 天内可退", invoice_text: "联系客服开票" } });
    await service.update({ watermark: { enabled: true } });

    const view = await service.read();
    expect(view.policy).toEqual({ refund_text: "7 天内可退", invoice_text: "联系客服开票" });
    expect(view.watermark.enabled).toBe(true);
  });

  it("坏 JSON → 抛配置错误，不静默当成关闭", async () => {
    const { service, rows } = serviceWith();
    rows.set("watermark", {
      setting_key: "watermark",
      setting_value: "{not-json",
      is_secret: false,
    });

    await expect(service.read()).rejects.toThrow(SystemSettingsConfigError);
  });

  it("enabled 不是布尔值 → 按关闭读（上游只接受 true 才加）", async () => {
    const { service, rows } = serviceWith();
    rows.set("watermark", {
      setting_key: "watermark",
      setting_value: JSON.stringify({ enabled: "true" }),
      is_secret: false,
    });

    await expect(service.read()).resolves.toMatchObject({
      watermark: { enabled: false },
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
