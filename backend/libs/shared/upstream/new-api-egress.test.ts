import { describe, expect, it, vi } from "vitest";

import { TRACE_ID_HEADER } from "@lib/core/logging";

import {
  NEW_API_BASE_URL_ENV,
  NewApiConfigError,
  UPSTREAM_KEY_ENV,
  UpstreamCredentialMissingError,
  newApiBaseUrl,
  newApiFetch,
  newApiUrl,
  resolveUpstreamCredential,
} from "./new-api-egress.js";

/**
 * new-api 的**唯一出口**。
 *
 * <p>在它之前 `NEW_API_BASE_URL` 被六处各读各的，于是「new-api 到底从哪进来」没有答案，
 * 只有六份各自的回答：拼接方式、trace 头、缺失时的行为各不相同。这个文件的断言就是
 * 那三件事的**唯一**口径——改这里等于改全部调用方。
 */
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
    // 返回空串的表现是 `fetch("/v1/chat/completions")` 打到自己身上、
    // 或者一个来路不明的 404——报错点离原因很远。
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

describe("resolveUpstreamCredential", () => {
  it("配了就返回（去掉首尾空白）", () => {
    expect(
      resolveUpstreamCredential({ [UPSTREAM_KEY_ENV]: "  sk-project-key  " }),
    ).toBe("sk-project-key");
  });

  it("★ 未配置就抛 503，而不是返回空串", () => {
    // 拿 `Bearer ` 去打 new-api 会收到一个 401——那是「上游不认」，读起来像凭证配错了，
    // 实际是压根没配。这两种要在错误类型上分开。
    expect(() => resolveUpstreamCredential({})).toThrow(UpstreamCredentialMissingError);
    expect(() => resolveUpstreamCredential({})).toThrow(UPSTREAM_KEY_ENV);
  });

  it("只填空格也算没配", () => {
    expect(() => resolveUpstreamCredential({ [UPSTREAM_KEY_ENV]: " \t " })).toThrow(
      UpstreamCredentialMissingError,
    );
  });

  it("★ 全项目只有这一个变量名 —— 它就是那把统一 key", () => {
    // 这条断言是「单一凭证」约定的机器可读形态：换名字 = 改这里 + 改出口，没有第三处。
    expect(UPSTREAM_KEY_ENV).toBe("NEW_API_UPSTREAM_KEY");
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
    // 出口刻意不管鉴权：new-api 有两套并存的鉴权模型（用户面的统一 key、
    // Agent 计费面的服务令牌 + 计费主体头）。塞进出口只会把分支换个地方。
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
    // Agent 网关会把 Agent 发来的 X-Trace-Id 透传下去，本地再生成一个会把它截断，
    // 而这条链路的价值恰恰是「用户点的那一下」能一路追到模型。
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
