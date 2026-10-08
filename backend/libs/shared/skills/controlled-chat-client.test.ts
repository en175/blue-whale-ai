import { describe, expect, it, vi } from "vitest";

import { createControlledChatClient } from "./controlled-chat-client.js";


const OPTIONS = {
  baseUrl: "http://new-api.test",
  token: "root-token",
  model: "test-model",
};

describe("createControlledChatClient（new-api 受控接口）", () => {
  it("POST /v1/chat/completions：Bearer 鉴权，system=规则 + 会话消息，返回首条 content", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "格式化后的 SKILL.md" } }],
        }),
        { status: 200 },
      ),
    );
    const client = createControlledChatClient({ ...OPTIONS, fetchImpl });
    const out = await client.complete({
      rules: "规则R",
      messages: [
        { role: "user", content: "第一条" },
        { role: "assistant", content: "第二条" },
      ],
    });
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
        { role: "user", content: "第一条" },
        { role: "assistant", content: "第二条" },
      ],
    });
  });

  it("上游非 2xx → 抛错（HTTP <status>）", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("boom", { status: 500 }));
    const client = createControlledChatClient({ ...OPTIONS, fetchImpl });
    await expect(
      client.complete({ rules: "r", messages: [] }),
    ).rejects.toThrow("HTTP 500");
  });

  it.each([
    ["无 choices", {}],
    ["content 为空串", { choices: [{ message: { content: "" } }] }],
    ["content 非字符串", { choices: [{ message: { content: 42 } }] }],
  ])("返回畸形（%s）→ 抛错（上层按失败分支处理）", async (_label, payload) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(payload), { status: 200 }),
      );
    const client = createControlledChatClient({ ...OPTIONS, fetchImpl });
    await expect(
      client.complete({ rules: "r", messages: [] }),
    ).rejects.toThrow("返回空内容");
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
    const client = createControlledChatClient({
      ...OPTIONS,
      fetchImpl,
      timeoutMs: 10,
    });
    await expect(
      client.complete({ rules: "r", messages: [] }),
    ).rejects.toThrow();
  });
});
