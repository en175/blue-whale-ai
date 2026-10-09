import { describe, expect, it, vi } from "vitest";

import { TRACE_ID_HEADER } from "@lib/core/logging";

import {
  NEW_API_BASE_URL_ENV,
  NewApiConfigError,
  UpstreamCredentialMissingError,
  newApiBaseUrl,
  newApiFetch,
  newApiUrl,
} from "./new-api-egress.js";

describe("newApiBaseUrl", () => {
  it("配了就返回，并去掉尾部斜杠（否则会拼出 //v1）", () => {
    expect(newApiBaseUrl({ [NEW_API_BASE_URL_ENV]: "http://new-api:3006/" })).toBe(
      "http://new-api:3006",
    );
    expect(newApiBaseUrl({ [NEW_API_BASE_URL_ENV]: "http://new-api:3006///" })).toBe(
      "http://new-api:3006",
    );
  });

  it("★ 未配置就抛，不返回空串", () => {
    expect(() => newApiBaseUrl({})).toThrow(NewApiConfigError);
    expect(() => newApiBaseUrl({})).toThrow(NEW_API_BASE_URL_ENV);
  });

  it("只填空格也算没配", () => {
    expect(() => newApiBaseUrl({ [NEW_API_BASE_URL_ENV]: "   " })).toThrow(NewApiConfigError);
  });
});

describe("newApiUrl", () => {
  it("拼接 base 与路径", () => {
    expect(newApiUrl("/v1/chat/completions", { [NEW_API_BASE_URL_ENV]: "http://a:1" })).toBe(
      "http://a:1/v1/chat/completions",
    );
  });
});

describe("UpstreamCredentialMissingError（凭证缺失的错误形态，值本身已搬到配置表）", () => {
  it("★ 503 + 专属错误码，与「上游不认这把 key」的 401 分开", () => {
    const error = new UpstreamCredentialMissingError();
    expect(error.status).toBe(503);
    expect(error.code).toBe("upstream_credential_missing");
  });

  it("文案指向管理端的具体位置，而不是「缺某个环境变量」", () => {
    expect(new UpstreamCredentialMissingError().message).toContain("管理端");
    expect(new UpstreamCredentialMissingError().message).not.toContain("环境变量");
  });
});

describe("newApiFetch", () => {
  const env = { [NEW_API_BASE_URL_ENV]: "http://new-api:3006" } as NodeJS.ProcessEnv;

  it("★ 打的是出口拼出来的地址，调用方不再自己拼", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await newApiFetch("/v1/chat/completions", { method: "POST" }, env);
      expect(fetchMock).toHaveBeenCalledWith(
        "http://new-api:3006/v1/chat/completions",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("★ 调用方带的 headers 一律保留（鉴权头不归出口管）", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await newApiFetch(
        "/v1/chat/completions",
        { headers: { authorization: "Bearer sk-x", "x-bw-subject-user-id": "42" } },
        env,
      );
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Headers;
      expect(headers.get("authorization")).toBe("Bearer sk-x");
      expect(headers.get("x-bw-subject-user-id")).toBe("42");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("★ 调用方**自己带了的** trace 头不被覆盖 —— 那是同一条链路的延续", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await newApiFetch("/v1/x", { headers: { [TRACE_ID_HEADER]: "from-agent" } }, env);
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers;
      expect(headers.get(TRACE_ID_HEADER)).toBe("from-agent");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("未配置时抛（不会静默打到错误的地址）", async () => {
    await expect(newApiFetch("/v1/x", {}, {} as NodeJS.ProcessEnv)).rejects.toThrow(
      NewApiConfigError,
    );
  });
});
