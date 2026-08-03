import { signVolcengineRequest } from "@blue-whale/core";

/** SMS provider 抽象 + 两个实现（对齐 Java SmsProvider / VolcengineSmsProvider / ConsoleSmsProvider）。 */
export interface SmsProvider {
  send(phone: string, code: string): Promise<void>;
}

export const consoleSmsProvider: SmsProvider = {
  async send(phone, code) {
    console.log(`[SMS console] phone=${phone} code=${code}`);
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
