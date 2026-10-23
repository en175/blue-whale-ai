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
});

describe("短信签名 — 电信走独立签名", () => {
  it("电信号码使用专用签名", async () => {
    const sentSign = stubSmsFetch();
    const provider = createVolcengineSmsProvider({
      ak: "ak",
      sk: "sk",
      smsAccount: "8c026cce",
      sign: "玄浮科技",
      signTelecom: "杭州玄浮科技",
      templateId: "tpl",
    });
    await provider.send("18912345678", "123456");
    expect(sentSign()).toBe("杭州玄浮科技");
  });

  it("移动与联通号码继续使用默认签名", async () => {
    const sentSign = stubSmsFetch();
    const provider = createVolcengineSmsProvider({
      ak: "ak",
      sk: "sk",
      smsAccount: "8c026cce",
      sign: "玄浮科技",
      signTelecom: "杭州玄浮科技",
      templateId: "tpl",
    });
    await provider.send("13812345678", "123456");
    expect(sentSign()).toBe("玄浮科技");
    await provider.send("13012345678", "123456");
    expect(sentSign()).toBe("玄浮科技");
  });

  it("未配置电信签名时电信号码也走默认签名", async () => {
    const sentSign = stubSmsFetch();
    const provider = createVolcengineSmsProvider({
      ak: "ak",
      sk: "sk",
      smsAccount: "8c026cce",
      sign: "玄浮科技",
      templateId: "tpl",
    });
    await provider.send("18912345678", "123456");
    expect(sentSign()).toBe("玄浮科技");
  });

  it("从环境变量 VOLC_SMS_SIGN_TELECOM 读取电信签名", async () => {
    const sentSign = stubSmsFetch();
    const provider = resolveSmsProvider({
      SMS_PROVIDER: "volcengine",
      VOLC_SMS_ACCOUNT: "8c026cce",
      VOLC_SMS_TEMPLATE_ID: "tpl",
      VOLC_SMS_SIGN: "玄浮科技",
      VOLC_SMS_SIGN_TELECOM: " 杭州玄浮科技 ",
      VOLC_ACCESS_KEY_ID: "ak",
      VOLC_SECRET_ACCESS_KEY: "sk",
    });
    await provider.send("13312345678", "123456");
    expect(sentSign()).toBe("杭州玄浮科技");
  });

  it("未配置 VOLC_SMS_SIGN_TELECOM 时电信号码默认用杭州玄浮科技", async () => {
    const sentSign = stubSmsFetch();
    const provider = resolveSmsProvider({
      SMS_PROVIDER: "volcengine",
      VOLC_SMS_ACCOUNT: "8c026cce",
      VOLC_SMS_TEMPLATE_ID: "tpl",
      VOLC_SMS_SIGN: "玄浮科技",
      VOLC_ACCESS_KEY_ID: "ak",
      VOLC_SECRET_ACCESS_KEY: "sk",
    });
    await provider.send("18912345678", "123456");
    expect(sentSign()).toBe("杭州玄浮科技");
    await provider.send("13812345678", "123456");
    expect(sentSign()).toBe("玄浮科技");
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
