// 素材库网关客户端（纯过境传输层）。
//
// 上游素材模块的信封（ResponseMetadata/Result、ResponseError）与非 2xx 响应必须
// **原样透传**给产品侧调用方（透传镜像决策），因此不复用 new-api-transport 的
// performRequest——那层按 new-api 信封做业务成败判定并抛错，会破坏透传语义。
// 本层只负责：拼路径、注入鉴权/追踪头、超时控制、原样返回 { status, body }。
// 网关不可达/超时才抛 NewApiError(503)，交由产品侧错误信封承接。
import { generateTraceId, getCurrentTraceId } from "./trace.js";
import { joinUrl, NewApiError } from "./new-api-transport.js";
import type { NewApiClientOptions } from "./new-api-types.js";

/** 上游原样回传：HTTP 状态码 + 响应体（JSON 解析失败回退原文）。 */
export interface MaterialLibraryResponse {
  status: number;
  body: unknown;
}

export interface MaterialLibraryClient {
  /** POST {baseUrl}/api/material/{action}，Bearer token 鉴权。不做信封判定。 */
  callAction(
    action: string,
    body: unknown,
    token: string,
  ): Promise<MaterialLibraryResponse>;
}

/** Action 名必须是纯字母（网关 Action 均为 PascalCase）；防路径注入。 */
const ACTION_PATTERN = /^[A-Za-z]+$/;

/** 创建素材库网关客户端。复用 NewApiClientOptions（baseUrl/fetchImpl/timeoutMs/traceIdProvider）。 */
export function createMaterialLibraryClient(
  options: NewApiClientOptions,
): MaterialLibraryClient {
  return {
    async callAction(action, body, token) {
      if (!ACTION_PATTERN.test(action)) {
        throw new NewApiError("不支持的素材操作", 400, "InvalidAction");
      }
      const fetchImpl = options.fetchImpl ?? fetch;
      const timeoutMs = options.timeoutMs ?? 20_000;
      const headers = new Headers();
      headers.set("Content-Type", "application/json");
      headers.set("Authorization", `Bearer ${token}`);
      const provided = options.traceIdProvider
        ? await options.traceIdProvider()
        : null;
      headers.set(
        "X-Trace-Id",
        provided ?? getCurrentTraceId() ?? generateTraceId(),
      );

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(
          joinUrl(options.baseUrl, `/api/material/${action}`),
          {
            method: "POST",
            headers,
            body: JSON.stringify(body ?? {}),
            signal: controller.signal,
          },
        );
      } catch {
        throw new NewApiError("素材库服务不可达", 503);
      } finally {
        clearTimeout(timeout);
      }

      let text = "";
      try {
        text = await response.text();
      } catch {
        // 响应体读取失败：保留状态码，空体透传（不伪装成成功）。
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      return { status: response.status, body: parsed };
    },
  };
}
