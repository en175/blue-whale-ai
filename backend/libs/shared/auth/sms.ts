import { signVolcengineRequest } from "@blue-whale/core";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

/** SMS provider 抽象 + 两个实现（对齐 Java SmsProvider / VolcengineSmsProvider / ConsoleSmsProvider）。 */
export interface SmsProvider {
  send(phone: string, code: string): Promise<void>;
}

export const consoleSmsProvider: SmsProvider = {
  async send(phone, code) {
    // dev 专用 console 实现（SMS_PROVIDER !== volcengine）；本地 TLS 为 noop，仅落 stdout。
    logger.info(`[SMS console] phone=${phone} code=${code}`);
  },
};

export interface VolcengineSmsConfig {
  ak: string;
  sk: string;
  smsAccount: string;
  sign: string;
  templateId: string;
  region?: string;
}

const SMS_HOST = "open.volcengineapi.com";

export function createVolcengineSmsProvider(
  config: VolcengineSmsConfig,
): SmsProvider {
  const region = config.region ?? "cn-beijing";
  return {
    async send(phone, code) {
      const templateParam = JSON.stringify({ code });
      const body = JSON.stringify({
        SmsAccount: config.smsAccount,
        Sign: config.sign,
        TemplateID: config.templateId,
        TemplateParam: templateParam,
        PhoneNumbers: phone,
        Tag: "blue-whale-user",
      });
      const signed = signVolcengineRequest({
        method: "POST",
        body,
        date: new Date(),
        action: "SendSms",
        version: "2020-01-01",
        region,
        service: "volcSMS",
        host: SMS_HOST,
        path: "/",
        ak: config.ak,
        sk: config.sk,
      });
      const res = await fetch(
        `https://${SMS_HOST}/?Action=SendSms&Version=2020-01-01`,
        {
          method: "POST",
          body,
          headers: {
            Host: SMS_HOST,
            "X-Date": signed.xDate,
            "X-Content-Sha256": signed.contentHash,
            "Content-Type": "application/json",
            Authorization: signed.authorization,
          },
        },
      );
      const json = (await res.json()) as {
        ResponseMetadata?: { Error?: { Code: string; Message: string } };
      };
      const err = json?.ResponseMetadata?.Error;
      if (err) throw new Error(`${err.Code}: ${err.Message}`);
    },
  };
}

/** env → SMS provider：SMS_PROVIDER=volcengine 走真短信，否则 console（dev）。 */
export function resolveSmsProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SmsProvider {
  if (env.SMS_PROVIDER === "volcengine") {
    return createVolcengineSmsProvider({
      ak: env.VOLC_ACCESS_KEY_ID ?? "",
      sk: env.VOLC_SECRET_ACCESS_KEY ?? "",
      smsAccount: env.VOLC_SMS_ACCOUNT ?? "",
      sign: env.VOLC_SMS_SIGN ?? "玄浮科技",
      templateId: env.VOLC_SMS_TEMPLATE_ID ?? "",
    });
  }
  return consoleSmsProvider;
}
