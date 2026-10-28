import { signVolcengineRequest } from "@lib/core";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

export interface SmsProvider {
  send(phone: string, code: string): Promise<void>;
}

export const consoleSmsProvider: SmsProvider = {
  async send(phone, code) {
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

export class SmsUpstreamError extends Error {
  constructor(
    readonly code: string,
    readonly upstreamMessage: string,
    readonly httpStatus: number,
  ) {
    super(`${code}: ${upstreamMessage}`);
    this.name = "SmsUpstreamError";
  }
}

const SMS_HOST = "open.volcengineapi.com";

type SmsResponse = {
  ResponseMetadata?: { Error?: { Code: string; Message: string } };
};

async function readSmsResponse(res: Response): Promise<SmsResponse> {
  try {
    return (await res.json()) as SmsResponse;
  } catch (error) {
    logger.warn("[sms] send failed", {
      stage: "response",
      http_status: res.status,
      error_type: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}

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
      let res: Response;
      try {
        res = await fetch(
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
      } catch (error) {
        logger.warn("[sms] send failed", {
          stage: "network",
          error_type: error instanceof Error ? error.name : typeof error,
          error_message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      const json = await readSmsResponse(res);
      const err = json?.ResponseMetadata?.Error;
      if (err) {
        logger.warn("[sms] send failed", {
          stage: "upstream",
          http_status: res.status,
          upstream_code: err.Code,
          upstream_message: err.Message,
        });
        throw new SmsUpstreamError(err.Code, err.Message, res.status);
      }
    },
  };
}

export function resolveSmsCredentials(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { ak: string; sk: string } {
  return {
    ak: env.VOLC_SMS_ACCESS_KEY_ID?.trim() || env.VOLC_ACCESS_KEY_ID || "",
    sk: env.VOLC_SMS_SECRET_ACCESS_KEY?.trim() || env.VOLC_SECRET_ACCESS_KEY || "",
  };
}

export function resolveSmsProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SmsProvider {
  if (env.SMS_PROVIDER === "volcengine") {
    const credentials = resolveSmsCredentials(env);
    return createVolcengineSmsProvider({
      ak: credentials.ak,
      sk: credentials.sk,
      smsAccount: env.VOLC_SMS_ACCOUNT ?? "",
      sign: env.VOLC_SMS_SIGN ?? "玄浮科技",
      templateId: env.VOLC_SMS_TEMPLATE_ID ?? "",
    });
  }
  return consoleSmsProvider;
}
