import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createVolcengineSmsProvider,
  resolveSmsCredentials,
  resolveSmsProvider,
} from "./sms.js";

function stubSmsFetch(): () => string {
  let sign = "";
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sign = (JSON.parse(String(init.body)) as { Sign?: string }).Sign ?? "";
    return new Response(JSON.stringify({ ResponseMetadata: {} }), {
      status: 200,
    });
  });
  return () => sign;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("短信签名 — 统一使用配置签名", () => {
  it("所有号段都使用配置的签名", async () => {
    const sentSign = stubSmsFetch();
    const provider = createVolcengineSmsProvider({
      ak: "ak",
      sk: "sk",
      smsAccount: "8c026cce",
      sign: "杭州玄浮科技",
      templateId: "tpl",
    });
    await provider.send("19967324916", "123456");
    expect(sentSign()).toBe("杭州玄浮科技");
    await provider.send("13812345678", "123456");
    expect(sentSign()).toBe("杭州玄浮科技");
  });

  it("从环境变量 VOLC_SMS_SIGN 读取签名并去除空白", async () => {
    const sentSign = stubSmsFetch();
    const provider = resolveSmsProvider({
      SMS_PROVIDER: "volcengine",
      VOLC_SMS_ACCOUNT: "8c026cce",
      VOLC_SMS_TEMPLATE_ID: "tpl",
      VOLC_SMS_SIGN: " 杭州玄浮科技 ",
      VOLC_ACCESS_KEY_ID: "ak",
      VOLC_SECRET_ACCESS_KEY: "sk",
    });
    await provider.send("13812345678", "123456");
    expect(sentSign()).toBe("杭州玄浮科技");
  });

  it("未配置 VOLC_SMS_SIGN 时默认杭州玄浮科技", async () => {
    const sentSign = stubSmsFetch();
    const provider = resolveSmsProvider({
      SMS_PROVIDER: "volcengine",
      VOLC_SMS_ACCOUNT: "8c026cce",
      VOLC_SMS_TEMPLATE_ID: "tpl",
      VOLC_ACCESS_KEY_ID: "ak",
      VOLC_SECRET_ACCESS_KEY: "sk",
    });
    await provider.send("13812345678", "123456");
    expect(sentSign()).toBe("杭州玄浮科技");
  });
});

describe("发送失败 — 记录上游可用的失败原因", () => {
  function provider() {
    return createVolcengineSmsProvider({
      ak: "ak",
      sk: "sk",
      smsAccount: "8c026cce",
      sign: "玄浮科技",
      templateId: "tpl",
    });
  }

  it("上游业务错误 → warn 带错误码与信息", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          ResponseMetadata: {
            Error: { Code: "InvalidTemplate", Message: "模板不存在" },
          },
        }),
        { status: 400 },
      ),
    );

    await expect(provider().send("13812345678", "123456")).rejects.toThrow(
      "InvalidTemplate: 模板不存在",
    );

    const record = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(record).toMatchObject({
      body: "[sms] send failed",
      stage: "upstream",
      http_status: 400,
      upstream_code: "InvalidTemplate",
      upstream_message: "模板不存在",
    });
  });

  it("网络异常 → warn 带异常类型与信息", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });

    await expect(provider().send("13812345678", "123456")).rejects.toThrow(
      "fetch failed",
    );

    const record = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(record).toMatchObject({
      body: "[sms] send failed",
      stage: "network",
      error_type: "TypeError",
      error_message: "fetch failed",
    });
  });

  it("上游返回非 JSON → warn 带 HTTP 状态", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => new Response("<html>bad gateway</html>", { status: 502 }));

    await expect(provider().send("13812345678", "123456")).rejects.toThrow();

    const record = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(record).toMatchObject({
      body: "[sms] send failed",
      stage: "response",
      http_status: 502,
    });
  });

  it("发送成功不写 warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubSmsFetch();

    await provider().send("13812345678", "123456");

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("resolveSmsCredentials — 短信 AK/SK 独立配置", () => {
  it("配置了短信专用 AK/SK 时优先使用", () => {
    expect(
      resolveSmsCredentials({
        VOLC_SMS_ACCESS_KEY_ID: "sms-ak",
        VOLC_SMS_SECRET_ACCESS_KEY: "sms-sk",
        VOLC_ACCESS_KEY_ID: "shared-ak",
        VOLC_SECRET_ACCESS_KEY: "shared-sk",
      }),
    ).toEqual({ ak: "sms-ak", sk: "sms-sk" });
  });

  it("未配置短信专用值时回退到共用 AK/SK", () => {
    expect(
      resolveSmsCredentials({
        VOLC_ACCESS_KEY_ID: "shared-ak",
        VOLC_SECRET_ACCESS_KEY: "shared-sk",
      }),
    ).toEqual({ ak: "shared-ak", sk: "shared-sk" });
  });

  it("短信专用值为空白时同样回退", () => {
    expect(
      resolveSmsCredentials({
        VOLC_SMS_ACCESS_KEY_ID: "   ",
        VOLC_SMS_SECRET_ACCESS_KEY: "",
        VOLC_ACCESS_KEY_ID: "shared-ak",
        VOLC_SECRET_ACCESS_KEY: "shared-sk",
      }),
    ).toEqual({ ak: "shared-ak", sk: "shared-sk" });
  });

  it("两者都未配置时返回空串", () => {
    expect(resolveSmsCredentials({})).toEqual({ ak: "", sk: "" });
  });
});
