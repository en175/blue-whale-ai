import { describe, expect, it, vi } from "vitest";

import type { AgentRequest } from "@blue-whale/core";

import { createNewApiAgentAdapter } from "./real-agent-adapter.js";

function chatCompletion(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function adapterReply(payload: unknown): string {
  return JSON.stringify(payload);
}

const BASE_REQUEST: AgentRequest = {
  prompt: "你好",
  historyMessages: [],
  runtimeInstructions: ["# Role\n你是蓝鲸 Agent。"],
  creativeSkill: null,
  mentionProjections: [],
};

function makeAdapter(fetchImpl: typeof fetch) {
  return createNewApiAgentAdapter({
    baseUrl: "http://new-api:3000",
    token: "test-token",
    model: "MiniMax-M3",
    fetchImpl,
  });
}

describe("new-api 真实 Agent 适配器（IK7EU4）", () => {
  it("ready() 恒可就绪（网关故障由 invoke 失败暴露）", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await makeAdapter(fetchImpl).ready()).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("respond：装配 OpenAI 兼容请求并返回模型文本", async () => {
    const fetchImpl = vi.fn(async () =>
      chatCompletion(
        adapterReply({
          content: "你好，我是蓝鲸。",
          reasoning_summary: "已完成回答。",
          action: { kind: "respond" },
        }),
      ),
    ) as unknown as typeof fetch;

    const adapter = makeAdapter(fetchImpl);
    expect(adapter.name).toBe("newapi-agent-runtime");
    const result = await adapter.invoke(BASE_REQUEST);

    expect(result).toEqual({
      provider: "newapi",
      content: "你好，我是蓝鲸。",
      reasoningSummary: "已完成回答。",
      action: { kind: "respond" },
    });

    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("http://new-api:3000/v1/chat/completions");
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token",
    );
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("MiniMax-M3");
    expect(body.messages[0]!.role).toBe("system");
    expect(body.messages[0]!.content).toContain("你是蓝鲸 Agent。");
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "你好" });
  });

  it("system 行为协议只使用 RunPin 冻结的 runtimeInstructions", async () => {
    const fetchImpl = vi.fn(async () =>
      chatCompletion(
        adapterReply({
          content: "你好。",
          reasoning_summary: "已完成回答。",
          action: { kind: "respond" },
        }),
      ),
    ) as unknown as typeof fetch;

    await makeAdapter(fetchImpl).invoke({
      ...BASE_REQUEST,
      runtimeInstructions: ["# Frozen Protocol\n只执行冻结协议。"],
    });

    const body = JSON.parse(
      ((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit)
        .body as string,
    ) as { messages: { role: string; content: string }[] };
    expect(body.messages[0]!.content).toBe(
      "# Frozen Protocol\n只执行冻结协议。",
    );
  });

  it("history 按序进入消息列表，当前 prompt 居末", async () => {
    const fetchImpl = vi.fn(async () =>
      chatCompletion(
        adapterReply({
          content: "继续。",
          reasoning_summary: "已完成回答。",
          action: { kind: "respond" },
        }),
      ),
    ) as unknown as typeof fetch;

    await makeAdapter(fetchImpl).invoke({
      ...BASE_REQUEST,
      historyMessages: [
        { role: "user", content: "第一条" },
        { role: "assistant", content: "第一答" },
      ],
    });

    const body = JSON.parse(
      ((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit)
        .body as string,
    ) as { messages: { role: string; content: string }[] };
    expect(body.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(body.messages[1]!.content).toBe("第一条");
    // assistant 历史消息以 JSON 协议形态发送（见下一测试的详细说明）。
    const historyAssistant = JSON.parse(body.messages[2]!.content) as {
      content: string;
      reasoning_summary: string;
      action: { kind: string };
    };
    expect(historyAssistant.content).toBe("第一答");
    expect(historyAssistant.reasoning_summary).toBeTruthy();
    expect(historyAssistant.action.kind).toBe("respond");
  });

  it("历史 assistant 消息包装为 JSON 协议形态，避免模型模仿纯文本放弃协议", async () => {
    // MiniMax-M3 在多轮对话中，若历史 assistant 是纯文本，会模仿该形态
    // 直接输出纯文本，不再遵守 system 要求的 JSON 输出协议，导致解析必
    // 失败（实测纯文本历史 10/10 失败，JSON 历史 10/10 成功）。适配器
    // 必须把历史 assistant 包装回协议 JSON 再发给模型。
    const fetchImpl = vi.fn(async () =>
      chatCompletion(
        adapterReply({
          content: "继续。",
          reasoning_summary: "已完成回答。",
          action: { kind: "respond" },
        }),
      ),
    ) as unknown as typeof fetch;

    await makeAdapter(fetchImpl).invoke({
      ...BASE_REQUEST,
      historyMessages: [
        { role: "user", content: "你好" },
        { role: "assistant", content: "你好，我是蓝鲸。" },
        { role: "user", content: "介绍能力" },
        { role: "assistant", content: "我可以帮你写文案、生成图片。" },
      ],
    });

    const body = JSON.parse(
      ((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit)
        .body as string,
    ) as { messages: { role: string; content: string }[] };
    // user 消息原样透传。
    expect(body.messages[1]!.content).toBe("你好");
    expect(body.messages[3]!.content).toBe("介绍能力");
    // 每条 assistant 历史都包装为合法 JSON 协议对象（含三字段）。
    for (const idx of [2, 4]) {
      const wrapped = JSON.parse(body.messages[idx]!.content) as {
        content: string;
        reasoning_summary: string;
        action: { kind: string };
      };
      expect(typeof wrapped.content).toBe("string");
      expect(wrapped.reasoning_summary).toBeTruthy();
      expect(wrapped.action.kind).toBe("respond");
    }
    // 原始纯文本保留在包装体的 content 字段。
    expect(
      (JSON.parse(body.messages[2]!.content) as { content: string }).content,
    ).toBe("你好，我是蓝鲸。");
  });

  it("激活 Creative Skill 正文与 mention 投影注入 system 上下文", async () => {
    const fetchImpl = vi.fn(async () =>
      chatCompletion(
        adapterReply({
          content: "好。",
          reasoning_summary: "已完成回答。",
          action: { kind: "respond" },
        }),
      ),
    ) as unknown as typeof fetch;

    await makeAdapter(fetchImpl).invoke({
      ...BASE_REQUEST,
      creativeSkill: {
        creativeSkillId: "poster_copy",
        creativeSkillVersionId: "v1",
        name: "海报文案",
        resourceDigest: "sha256:x",
        body: "# 海报文案技能\n三步成稿。",
      },
      mentionProjections: [
        {
          mention_id: "m-scene-1",
          type: "scene_card",
          availability: "available",
          projection: { kind: "scene_card", title: "分镜 1" },
        },
      ],
    } as unknown as AgentRequest);

    const body = JSON.parse(
      ((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit)
        .body as string,
    ) as { messages: { role: string; content: string }[] };
    const system = body.messages[0]!.content;
    expect(system).toContain("三步成稿。");
    expect(system).toContain("m-scene-1");
  });

  it("clarify 与 cancel 动作映射", async () => {
    const clarifyFetch = vi.fn(async () =>
      chatCompletion(
        adapterReply({
          content: "请告诉我主体是什么？",
          reasoning_summary: "需求缺少主体。",
          action: { kind: "clarify", question: "请告诉我主体是什么？", stage: "alignment" },
        }),
      ),
    ) as unknown as typeof fetch;
    const clarify = await makeAdapter(clarifyFetch).invoke(BASE_REQUEST);
    expect(clarify.action).toEqual({
      kind: "clarify",
      question: "请告诉我主体是什么？",
      stage: "alignment",
    });

    const cancelFetch = vi.fn(async () =>
      chatCompletion(
        adapterReply({
          content: "好的，已停止。",
          reasoning_summary: "按 User 要求停止。",
          action: { kind: "cancel" },
        }),
      ),
    ) as unknown as typeof fetch;
    const cancel = await makeAdapter(cancelFetch).invoke(BASE_REQUEST);
    expect(cancel.action).toEqual({ kind: "cancel" });
  });

  it("submit_plan：snake_case 卡片映射为 core camelCase 候选", async () => {
    const fetchImpl = vi.fn(async () =>
      chatCompletion(
        adapterReply({
          content: "已完成需求对齐，正式提交 1 张计划卡。",
          reasoning_summary: "需求已确认，提交计划卡。",
          action: {
            kind: "submit_plan",
            cards: [
              {
                application_kind: "image_generate",
                title: "蓝鲸海报",
                content_markdown: "主体「蓝鲸」。",
                summary: "海报一图",
                sequence_label_noun: "分镜",
                parameter_overrides: {
                  size: "1024x1024",
                  aspect_ratio: "1:1",
                  count: 2,
                },
              },
              {
                application_kind: "scene_card_create",
                title: "新建场景卡",
                content_markdown: "创建新场景。",
              },
            ],
          },
        }),
      ),
    ) as unknown as typeof fetch;

    const result = await makeAdapter(fetchImpl).invoke(BASE_REQUEST);

    expect(result.action).toEqual({
      kind: "submit_plan",
      cards: [
        {
          applicationKind: "image_generate",
          title: "蓝鲸海报",
          contentMarkdown: "主体「蓝鲸」。",
          summary: "海报一图",
          sequenceLabelNoun: "分镜",
          parameterOverrides: {
            size: "1024x1024",
            aspectRatio: "1:1",
            count: 2,
          },
        },
        {
          applicationKind: "scene_card_create",
          title: "新建场景卡",
          contentMarkdown: "创建新场景。",
        },
      ],
    });
  });

  it("submit_plan 接受首帧 mention_seq=0", async () => {
    const fetchImpl = vi.fn(async () =>
      chatCompletion(
        adapterReply({
          content: "提交视频计划。",
          reasoning_summary: "需求已确认。",
          action: {
            kind: "submit_plan",
            cards: [
              {
                application_kind: "scene_card_create",
                title: "开场",
                content_markdown: "使用首帧。",
                parameter_overrides: { first_frame_mention_seq: 0 },
              },
            ],
          },
        }),
      ),
    ) as unknown as typeof fetch;

    const result = await makeAdapter(fetchImpl).invoke(BASE_REQUEST);

    expect(result.action).toEqual({
      kind: "submit_plan",
      cards: [
        {
          applicationKind: "scene_card_create",
          title: "开场",
          contentMarkdown: "使用首帧。",
          parameterOverrides: { firstFrameMentionSeq: 0 },
        },
      ],
    });
  });

  it("submit_plan 拒绝小数 duration", async () => {
    const fetchImpl = vi.fn(async () =>
      chatCompletion(
        adapterReply({
          content: "提交视频计划。",
          reasoning_summary: "需求已确认。",
          action: {
            kind: "submit_plan",
            cards: [
              {
                application_kind: "scene_card_create",
                title: "开场",
                content_markdown: "生成视频。",
                parameter_overrides: { duration: 1.5 },
              },
            ],
          },
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(makeAdapter(fetchImpl).invoke(BASE_REQUEST)).rejects.toThrow();
  });

  it("submit_plan 拒绝非十进制替换目标", async () => {
    const fetchImpl = vi.fn(async () =>
      chatCompletion(
        adapterReply({
          content: "提交替换计划。",
          reasoning_summary: "需求已确认。",
          action: {
            kind: "submit_plan",
            cards: [
              {
                application_kind: "scene_card_replace",
                title: "替换场景",
                content_markdown: "替换变化。",
                target_scene_card_mention_id: "m-scene-1",
              },
            ],
          },
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(makeAdapter(fetchImpl).invoke(BASE_REQUEST)).rejects.toThrow();
  });

  it("submit_plan 拒绝替换卡与其它卡混批", async () => {
    const fetchImpl = vi.fn(async () =>
      chatCompletion(
        adapterReply({
          content: "提交混合计划。",
          reasoning_summary: "需求已确认。",
          action: {
            kind: "submit_plan",
            cards: [
              {
                application_kind: "image_generate",
                title: "海报",
                content_markdown: "生成海报。",
              },
              {
                application_kind: "scene_card_replace",
                title: "替换场景",
                content_markdown: "替换变化。",
                target_scene_card_mention_id: "123",
              },
            ],
          },
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(makeAdapter(fetchImpl).invoke(BASE_REQUEST)).rejects.toThrow();
  });

  it("容忍 ```json 代码围栏包裹的响应", async () => {
    const fetchImpl = vi.fn(async () =>
      chatCompletion(
        `\`\`\`json\n${adapterReply({
          content: "你好。",
          reasoning_summary: "已完成回答。",
          action: { kind: "respond" },
        })}\n\`\`\``,
      ),
    ) as unknown as typeof fetch;

    const result = await makeAdapter(fetchImpl).invoke(BASE_REQUEST);
    expect(result.content).toBe("你好。");
  });

  it("HTTP 非 2xx 抛错（走 worker 既有失败语义）", async () => {
    const fetchImpl = vi.fn(async () =>
      chatCompletion("ignored", 500),
    ) as unknown as typeof fetch;

    await expect(makeAdapter(fetchImpl).invoke(BASE_REQUEST)).rejects.toThrow(
      "HTTP 500",
    );
  });

  it("返回非 JSON、缺字段或未知 action 一律抛错（协议预算 0 不修复）", async () => {
    const nonJson = vi.fn(async () =>
      chatCompletion("这不是 JSON"),
    ) as unknown as typeof fetch;
    await expect(makeAdapter(nonJson).invoke(BASE_REQUEST)).rejects.toThrow();

    const missingAction = vi.fn(async () =>
      chatCompletion(
        adapterReply({ content: "你好。", reasoning_summary: "已完成回答。" }),
      ),
    ) as unknown as typeof fetch;
    await expect(
      makeAdapter(missingAction).invoke(BASE_REQUEST),
    ).rejects.toThrow();

    const unknownAction = vi.fn(async () =>
      chatCompletion(
        adapterReply({
          content: "你好。",
          reasoning_summary: "已完成回答。",
          action: { kind: "delete_database" },
        }),
      ),
    ) as unknown as typeof fetch;
    await expect(
      makeAdapter(unknownAction).invoke(BASE_REQUEST),
    ).rejects.toThrow();
  });
});
