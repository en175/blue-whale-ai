import { describe, expect, it, vi } from "vitest";

import { createSkillFormatChatClient } from "./format-ai-client.js";
import {
  DEFAULT_SKILL_FORMAT_RULES,
  loadSkillFormatRules,
} from "./format-rules.js";

// 受控 chat 客户端与固定规则（IK60X0）：fetchImpl 注入即可控 AI 替身，不触网。

const OPTIONS = {
  baseUrl: "http://new-api.test",
  token: "root-token",
  model: "test-model",
};

describe("createSkillFormatChatClient", () => {
  it("POST /v1/chat/completions：Bearer 鉴权，system=固定规则、user=草稿，返回文本", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "格式化后的 SKILL.md" } }],
        }),
        { status: 200 },
      ),
    );
    const client = createSkillFormatChatClient({ ...OPTIONS, fetchImpl });
    const out = await client.complete({ rules: "规则R", draft: "草稿D" });
    expect(out).toBe("格式化后的 SKILL.md");

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://new-api.test/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer root-token",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      model: "test-model",
      messages: [
        { role: "system", content: "规则R" },
        { role: "user", content: "草稿D" },
      ],
    });
  });

  it("上游非 2xx → 抛错", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("boom", { status: 500 }));
    const client = createSkillFormatChatClient({ ...OPTIONS, fetchImpl });
    await expect(client.complete({ rules: "r", draft: "d" })).rejects.toThrow(
      "HTTP 500",
    );
  });

  it("超时 → abort 抛错（上游挂起不会无限等待）", async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;
    const client = createSkillFormatChatClient({
      ...OPTIONS,
      fetchImpl,
      timeoutMs: 10,
    });
    await expect(client.complete({ rules: "r", draft: "d" })).rejects.toThrow();
  });

  it.each([
    ["无 choices", {}],
    ["content 为空串", { choices: [{ message: { content: "" } }] }],
    ["content 非字符串", { choices: [{ message: { content: 42 } }] }],
  ])("返回畸形（%s）→ 抛错", async (_label, payload) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(payload), { status: 200 }),
      );
    const client = createSkillFormatChatClient({ ...OPTIONS, fetchImpl });
    await expect(client.complete({ rules: "r", draft: "d" })).rejects.toThrow(
      "返回空内容",
    );
  });
});

describe("loadSkillFormatRules", () => {
  it("env 无覆盖 → 默认固定规则", () => {
    expect(loadSkillFormatRules({})).toBe(DEFAULT_SKILL_FORMAT_RULES);
  });

  it("SKILL_FORMAT_RULES 覆盖默认（后台可配）；纯空白视为未覆盖", () => {
    expect(loadSkillFormatRules({ SKILL_FORMAT_RULES: "自定义规则" })).toBe(
      "自定义规则",
    );
    expect(loadSkillFormatRules({ SKILL_FORMAT_RULES: "   " })).toBe(
      DEFAULT_SKILL_FORMAT_RULES,
    );
  });
});
