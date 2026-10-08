import { generateTraceId, getCurrentTraceId } from "./trace.js";
import { joinUrl, NewApiError } from "./new-api-transport.js";
import type { NewApiClientOptions } from "./new-api-types.js";

export interface MaterialLibraryResponse {
  status: number;
  body: unknown;
}

export interface MaterialLibraryClient {
  callAction(
    action: string,
    body: unknown,
    token: string,
  ): Promise<MaterialLibraryResponse>;
}

const ACTION_PATTERN = /^[A-Za-z]+$/;

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
