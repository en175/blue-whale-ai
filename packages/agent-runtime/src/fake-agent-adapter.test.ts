import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createFakeAgentAdapter } from "./fake-agent-adapter.js";

describe("Fake Agent Adapter", () => {
  const request = (
    prompt: string,
    historyMessages: readonly { role: "user" | "assistant"; content: string }[] = [],
  ) => ({
    prompt,
    historyMessages,
    runtimeInstructions: [],
    creativeSkill: null,
  });

  it("同一输入产生稳定的候选文字", async () => {
    const adapter = createFakeAgentAdapter();

    await expect(adapter.invoke(request("hello"))).resolves.toEqual({
      provider: "fake",
      content:
        "fake-agent-response:05d37bdcd85047a772a96d21d5b472781d711e3c423e989b26da887c07895ac1",
      reasoningSummary: "已完成回答。",
      action: { kind: "respond" },
    });
  });

  it("fake:failure 标记抛出明确失败", async () => {
    const adapter = createFakeAgentAdapter();

    await expect(
      adapter.invoke(request("请失败 fake:failure")),
    ).rejects.toThrow("fake agent explicit failure");
  });

  it("fake:delay 标记挂起后仍返回确定性回显", async () => {
    const adapter = createFakeAgentAdapter();
    const prompt = "慢一点 fake:delay:120";

    const started = Date.now();
    const result = await adapter.invoke(request(prompt));
    expect(Date.now() - started).toBeGreaterThanOrEqual(120);

    const fingerprint = createHash("sha256")
      .update(`blue-whale-agent-fake-v1\n${prompt}`)
      .digest("hex");
    expect(result).toEqual({
      provider: "fake",
      content: `fake-agent-response:${fingerprint}`,
      reasoningSummary: "已完成回答。",
      action: { kind: "respond" },
    });
  });

  it("selected Skill affects the response by pinned digest without exposing its body", async () => {
    const adapter = createFakeAgentAdapter();
    const result = await adapter.invoke({
      prompt: "海报专家",
      historyMessages: [],
      runtimeInstructions: [],
      creativeSkill: {
        creativeSkillId: "official.poster",
        creativeSkillVersionId: "version.poster.1",
        name: "海报专家",
        resourceDigest: `sha256:${"a".repeat(64)}`,
        body: "private instructions",
      },
    });

    expect(result.reasoningSummary).toBe("已使用「海报专家」完成回答。");
    expect(result.content).not.toContain("private instructions");
    expect(result.content).not.toContain("海报专家");
  });
});

// PlanPhase 对齐脚本（Node Agent Runtime Contract §6/§7）：
// 创作标记驱动澄清→复述→确认→完成；普通输入保持确定性回显。
describe("Fake Agent Adapter PlanPhase", () => {
  const request = (
    prompt: string,
    historyMessages: readonly { role: "user" | "assistant"; content: string }[] = [],
  ) => ({
    prompt,
    historyMessages,
    runtimeInstructions: [],
    creativeSkill: null,
    mentionProjections: [] as const,
  });
  const adapter = createFakeAgentAdapter();

  it("创作请求缺少主体与预期时只询问第一个缺失项", async () => {
    const result = await adapter.invoke(request("创作：一张海报"));
    expect(result.action).toEqual({
      kind: "clarify",
      question: "请告诉我这次创作的主体是什么？",
      stage: "alignment",
    });
    expect(result.content).toBe("请告诉我这次创作的主体是什么？");
  });

  it("修改请求缺少目标与变化时先问目标", async () => {
    const result = await adapter.invoke(request("修改：海报"));
    expect(result.action).toEqual({
      kind: "clarify",
      question: "请告诉我这次修改的目标是什么？",
      stage: "alignment",
    });
  });

  it("你决定为待回答的缺失项补默认值", async () => {
    const result = await adapter.invoke(
      request("你决定", [
        { role: "user", content: "创作：一张海报" },
        { role: "assistant", content: "请告诉我这次创作的主体是什么？" },
      ]),
    );
    expect(result.action).toEqual({
      kind: "clarify",
      question: "请告诉我你期望的结果是什么？",
      stage: "alignment",
    });
  });

  it("不受支持的要求继续澄清而不是静默降级", async () => {
    const result = await adapter.invoke(
      request("创作：一张海报，主体：蓝鲸，预期：极简海报，不支持：立体渲染"),
    );
    expect(result.action).toMatchObject({
      kind: "clarify",
      stage: "alignment",
    });
    expect(result.content).toContain("「立体渲染」目前不受支持");
  });

  it("你决定不得移除不受支持的要求", async () => {
    const result = await adapter.invoke(
      request("你决定", [
        {
          role: "user",
          content: "创作：一张海报，主体：蓝鲸，预期：极简海报，不支持：立体渲染",
        },
        {
          role: "assistant",
          content: "「立体渲染」目前不受支持，请改为受支持的要求后重新告诉我。",
        },
      ]),
    );
    expect(result.action).toMatchObject({ kind: "clarify", stage: "alignment" });
    expect(result.content).toContain("「立体渲染」目前不受支持");
  });

  it("重新给出受支持的要求后解除不受支持项", async () => {
    const result = await adapter.invoke(
      request("预期：动态海报", [
        {
          role: "user",
          content: "创作：一张海报，主体：蓝鲸，预期：极简海报，不支持：立体渲染",
        },
        {
          role: "assistant",
          content: "「立体渲染」目前不受支持，请改为受支持的要求后重新告诉我。",
        },
      ]),
    );
    expect(result.action).toEqual({
      kind: "clarify",
      question: "确认以上需求并正式提交计划吗？",
      stage: "awaiting_final_confirmation",
    });
  });

  it("对齐完成后复述需求并要求最终确认", async () => {
    const result = await adapter.invoke(
      request("预期：极简海报", [
        { role: "user", content: "创作：一张海报，主体：蓝鲸" },
        { role: "assistant", content: "请告诉我你期望的结果是什么？" },
      ]),
    );
    expect(result.action).toEqual({
      kind: "clarify",
      question: "确认以上需求并正式提交计划吗？",
      stage: "awaiting_final_confirmation",
    });
    expect(result.content).toBe(
      "需求复述：主体「蓝鲸」，预期「极简海报」。确认无误后我将正式提交计划。",
    );
  });

  it("立即出计划在必需项齐备时跳过最终确认直接提交单卡", async () => {
    const result = await adapter.invoke(
      request("立即出计划", [
        { role: "user", content: "创作：一张海报，主体：蓝鲸，预期：极简海报" },
        { role: "assistant", content: "请告诉我你期望的结果是什么？" },
      ]),
    );
    expect(result.action).toEqual({
      kind: "submit_plan",
      cards: [
        {
          applicationKind: "image_generate",
          title: "蓝鲸",
          contentMarkdown: "主体「蓝鲸」，预期「极简海报」。",
        },
      ],
    });
  });

  it("对确认请求回复同意后提交计划卡候选", async () => {
    const result = await adapter.invoke(
      request("同意", [
        { role: "user", content: "创作：一张海报，主体：蓝鲸，预期：极简海报" },
        {
          role: "assistant",
          content:
            "需求复述：主体「蓝鲸」，预期「极简海报」。确认无误后我将正式提交计划。",
        },
      ]),
    );
    expect(result.action).toEqual({
      kind: "submit_plan",
      cards: [
        {
          applicationKind: "image_generate",
          title: "蓝鲸",
          contentMarkdown: "主体「蓝鲸」，预期「极简海报」。",
        },
      ],
    });
    expect(result.content).toBe(
      "已完成需求对齐：主体「蓝鲸」，预期「极简海报」；正式提交 1 张计划卡。",
    );
  });

  it("出两张标记产 2 卡混合 image_generate + scene_card_create 并带分镜名词", async () => {
    const result = await adapter.invoke(
      request(
        "创作：主体：蓝鲸，预期：动态海报，出两张 立即出计划",
      ),
    );
    expect(result.action.kind).toBe("submit_plan");
    if (result.action.kind !== "submit_plan") return;
    expect(result.action.cards).toHaveLength(2);
    expect(result.action.cards[0]).toMatchObject({
      applicationKind: "image_generate",
      sequenceLabelNoun: "分镜",
    });
    expect(result.action.cards[1]).toMatchObject({
      applicationKind: "scene_card_create",
      sequenceLabelNoun: "分镜",
    });
  });

  it("覆盖场景卡标记产独占 scene_card_replace 并绑定本轮场景卡句柄", async () => {
    const result = await adapter.invoke({
      prompt: "修改：目标：开场分镜，变化：变明亮 覆盖场景卡 立即出计划",
      historyMessages: [],
      runtimeInstructions: [],
      creativeSkill: null,
      mentionProjections: [
        {
          mention_id: "501",
          type: "scene_card",
          availability: "available",
          projection: {
            title: "开场分镜",
            summary: null,
            content_markdown: "原内容",
            version: 3,
          },
        },
      ],
    });
    expect(result.action.kind).toBe("submit_plan");
    if (result.action.kind !== "submit_plan") return;
    expect(result.action.cards).toHaveLength(1);
    expect(result.action.cards[0]).toMatchObject({
      applicationKind: "scene_card_replace",
      targetSceneCardMentionId: "501",
    });
  });

  it("覆盖场景卡但本轮无可用场景卡时回退自然语言澄清", async () => {
    const result = await adapter.invoke(
      request("修改：目标：开场分镜，变化：变明亮 覆盖场景卡 立即出计划"),
    );
    expect(result.action).toMatchObject({ kind: "clarify", stage: "alignment" });
    expect(result.content).toContain("请先引用要覆盖的场景卡");
  });

  it("必需项未齐时同意不直接完成，回到缺失项", async () => {
    const result = await adapter.invoke(
      request("同意", [
        { role: "user", content: "创作：一张海报，主体：蓝鲸" },
        { role: "assistant", content: "请告诉我你期望的结果是什么？" },
      ]),
    );
    expect(result.action).toEqual({
      kind: "clarify",
      question: "请告诉我你期望的结果是什么？",
      stage: "alignment",
    });
  });

  it("继续讨论回到 alignment 阶段", async () => {
    const result = await adapter.invoke(
      request("继续讨论", [
        { role: "user", content: "创作：一张海报，主体：蓝鲸，预期：极简海报" },
        {
          role: "assistant",
          content:
            "需求复述：主体「蓝鲸」，预期「极简海报」。确认无误后我将正式提交计划。",
        },
      ]),
    );
    expect(result.action).toMatchObject({
      kind: "clarify",
      stage: "alignment",
    });
  });

  it("不要创建计划与停止都取消当前对齐", async () => {
    for (const prompt of ["不要创建计划", "停止"]) {
      const result = await adapter.invoke(
        request(prompt, [
          { role: "user", content: "创作：一张海报" },
          { role: "assistant", content: "请告诉我这次创作的主体是什么？" },
        ]),
      );
      expect(result.action).toEqual({ kind: "cancel" });
      expect(result.content).toBe("好的，已按你的要求停止，不会创建计划。");
    }
  });

  it("完成对齐后的普通问答保持确定性回显", async () => {
    const result = await adapter.invoke(
      request("什么是蓝鲸？", [
        { role: "user", content: "创作：一张海报，主体：蓝鲸，预期：极简海报" },
        {
          role: "assistant",
          content:
            "需求复述：主体「蓝鲸」，预期「极简海报」。确认无误后我将正式提交计划。",
        },
        { role: "user", content: "同意" },
        { role: "assistant", content: "已完成需求对齐：主体「蓝鲸」，预期「极简海报」。" },
      ]),
    );
    expect(result.action).toEqual({ kind: "respond" });
    expect(result.content).toMatch(/^fake-agent-response:/);
  });

  it("取消后的新创作目标重新澄清，不继承已取消的取值", async () => {
    const result = await adapter.invoke(
      request("创作：另一张海报", [
        { role: "user", content: "创作：一张海报，主体：蓝鲸，预期：极简海报" },
        {
          role: "assistant",
          content:
            "需求复述：主体「蓝鲸」，预期「极简海报」。确认无误后我将正式提交计划。",
        },
        { role: "user", content: "不要创建计划" },
        { role: "assistant", content: "好的，已按你的要求停止，不会创建计划。" },
      ]),
    );
    expect(result.action).toEqual({
      kind: "clarify",
      question: "请告诉我这次创作的主体是什么？",
      stage: "alignment",
    });
  });
});
