import { describe, expect, it, vi } from "vitest";

import {
  createSkillSummarizePipeline,
  createUnavailableSkillSummarizePipeline,
  loadSkillSummarizeRules,
  DEFAULT_SKILL_SUMMARIZE_RULES,
  SkillNameTakenError,
  type PersonalSkillCreator,
  type SkillSummarizeChatClient,
  type SkillSummarizeStore,
} from "./skill-summarize.js";

// 对话总结保存个人技能管道（IK60X1，契约 §15）分支覆盖：
// 充分保存成功 / 不足询问 / 非法重试 / AI 失败 / 100101+100102 冲突提议 /
// 确认重试成功 / 改名确认 / 再冲突重新提议 / 取消 / 无关 pass_through /
// 确认模式 AI 失败保持 pending / 跨用户隔离（userId 透传）。

const VALID_SKILL_MD = `---
name: 周报生成
description: 根据要点生成周报
---

# 步骤

1. 收集要点
2. 输出周报`;

const WORK = { conversationId: "7", userId: "100", prompt: "总结当前对话" };

function makeDeps(overrides?: {
  chat?: SkillSummarizeChatClient;
  store?: Partial<SkillSummarizeStore>;
  skills?: Partial<PersonalSkillCreator>;
}) {
  const chat: SkillSummarizeChatClient = overrides?.chat ?? {
    complete: vi.fn().mockResolvedValue(VALID_SKILL_MD),
  };
  const store: SkillSummarizeStore = {
    findPending: vi.fn().mockResolvedValue(null),
    upsertPending: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    listRecentMessages: vi.fn().mockResolvedValue([
      { role: "user", content: "怎么做周报" },
      { role: "assistant", content: "先收集要点……" },
    ]),
    ...overrides?.store,
  };
  const skills: PersonalSkillCreator = {
    createPersonalSkill: vi
      .fn()
      .mockImplementation(
        (_userId: string, input: { name: string; description: string }) =>
          Promise.resolve({
            creative_skill_id: "weekly_report",
            name: input.name,
            description: input.description,
          }),
      ),
    checkPersonalNameAvailable: vi.fn().mockResolvedValue("ok"),
    ...overrides?.skills,
  };
  return { chat, store, skills };
}

describe("总结模式（契约 §15.3）", () => {
  it("信息充分 → 校验通过即保存（无第二次确认），返回技能名", async () => {
    const deps = makeDeps();
    const pipeline = createSkillSummarizePipeline(deps);

    const outcome = await pipeline.run(WORK);

    expect(outcome.kind).toBe("handled");
    if (outcome.kind === "handled") {
      expect(outcome.content).toContain("周报生成");
      expect(outcome.content).toContain("已总结当前对话并保存");
    }
    expect(deps.skills.createPersonalSkill).toHaveBeenCalledWith("100", {
      name: "周报生成",
      description: "根据要点生成周报",
      body: "# 步骤\n\n1. 收集要点\n2. 输出周报",
    });
    expect(deps.store.listRecentMessages).toHaveBeenCalledWith({
      conversationId: "7",
      limit: 50,
    });
    expect(deps.store.upsertPending).not.toHaveBeenCalled();
  });

  it("AI 输出带代码围栏也能宽松解析", async () => {
    const deps = makeDeps({
      chat: {
        complete: vi
          .fn()
          .mockResolvedValue("```markdown\n" + VALID_SKILL_MD + "\n```"),
      },
    });
    const outcome = await createSkillSummarizePipeline(deps).run(WORK);
    expect(outcome.kind).toBe("handled");
    expect(deps.skills.createPersonalSkill).toHaveBeenCalled();
  });

  it("信息不足 → 不创建技能，说明缺什么", async () => {
    const deps = makeDeps({
      chat: {
        complete: vi
          .fn()
          .mockResolvedValue("[信息不足] 对话里还没有具体的操作步骤，请补充。"),
      },
    });
    const outcome = await createSkillSummarizePipeline(deps).run(WORK);
    expect(outcome).toEqual({
      kind: "handled",
      content: "对话里还没有具体的操作步骤，请补充。",
    });
    expect(deps.skills.createPersonalSkill).not.toHaveBeenCalled();
  });

  it("输出非法 → 重试一次，仍非法按失败处理，不创建技能", async () => {
    const complete = vi.fn().mockResolvedValue("这不是 SKILL.md");
    const deps = makeDeps({ chat: { complete } });
    const outcome = await createSkillSummarizePipeline(deps).run(WORK);
    expect(outcome.kind).toBe("handled");
    if (outcome.kind === "handled") {
      expect(outcome.content).toContain("未创建技能");
    }
    expect(complete).toHaveBeenCalledTimes(2);
    expect(deps.skills.createPersonalSkill).not.toHaveBeenCalled();
  });

  it("AI 抛错/超时 → 失败说明，不创建技能（正常完成不走 commitFailure）", async () => {
    const deps = makeDeps({
      chat: { complete: vi.fn().mockRejectedValue(new Error("timeout")) },
    });
    const outcome = await createSkillSummarizePipeline(deps).run(WORK);
    expect(outcome.kind).toBe("handled");
    if (outcome.kind === "handled") {
      expect(outcome.content).toContain("未创建技能");
    }
    expect(deps.skills.createPersonalSkill).not.toHaveBeenCalled();
  });

  it("frontmatter 字段为空 → 按非法输出处理", async () => {
    const deps = makeDeps({
      chat: {
        complete: vi
          .fn()
          .mockResolvedValue("---\nname: \ndescription: d\n---\n\n正文"),
      },
    });
    const outcome = await createSkillSummarizePipeline(deps).run(WORK);
    if (outcome.kind === "handled") {
      expect(outcome.content).toContain("未创建技能");
    }
    expect(deps.skills.createPersonalSkill).not.toHaveBeenCalled();
  });

  it("名称冲突（100101/100102）→ 禁止保存，提议服务端验证可用的新名并挂入待确认会话", async () => {
    const createPersonalSkill = vi
      .fn()
      .mockRejectedValue(new SkillNameTakenError("个人技能同名冲突: 周报生成"));
    const namingComplete = vi
      .fn()
      .mockResolvedValueOnce(VALID_SKILL_MD) // 总结调用
      .mockResolvedValueOnce("周报小助手"); // 提议名调用
    const checkPersonalNameAvailable = vi.fn().mockResolvedValue("ok");
    const deps = makeDeps({
      chat: { complete: namingComplete },
      skills: { createPersonalSkill, checkPersonalNameAvailable },
    });
    const outcome = await createSkillSummarizePipeline(deps).run(WORK);

    // 未落库（create 抛冲突），草稿 + 提议名写入 pending。
    expect(deps.store.upsertPending).toHaveBeenCalledWith({
      conversationId: "7",
      userId: "100",
      draftContent: VALID_SKILL_MD,
      proposedName: "周报小助手",
    });
    expect(checkPersonalNameAvailable).toHaveBeenCalledWith(
      "100",
      "周报小助手",
    );
    expect(outcome.kind).toBe("handled");
    if (outcome.kind === "handled") {
      expect(outcome.content).toContain("周报生成");
      expect(outcome.content).toContain("周报小助手");
      expect(outcome.content).toContain("未保存");
    }
  });

  it("冲突且 AI 提议名两次都不可用 → 仍挂 pending（proposedName 记占用名），请用户直接给新名", async () => {
    const createPersonalSkill = vi
      .fn()
      .mockRejectedValue(new SkillNameTakenError("conflict"));
    const namingComplete = vi
      .fn()
      .mockResolvedValueOnce(VALID_SKILL_MD) // 总结调用
      .mockResolvedValueOnce("深度写作") // 提议①：官方保留名
      .mockResolvedValueOnce("周报生成"); // 提议②：仍是占用名
    const checkPersonalNameAvailable = vi
      .fn()
      .mockImplementation((_u: string, name: string) =>
        Promise.resolve(name === "深度写作" ? "reserved" : "conflict"),
      );
    const deps = makeDeps({
      chat: { complete: namingComplete },
      skills: { createPersonalSkill, checkPersonalNameAvailable },
    });
    const outcome = await createSkillSummarizePipeline(deps).run(WORK);

    // 不做本地序号兜底（CONTEXT.md Avoid）；草稿挂 pending，proposedName 记占用名。
    expect(deps.store.upsertPending).toHaveBeenCalledWith({
      conversationId: "7",
      userId: "100",
      draftContent: VALID_SKILL_MD,
      proposedName: "周报生成",
    });
    if (outcome.kind === "handled") {
      expect(outcome.content).toContain("请直接回复一个你想要的新名称");
      expect(outcome.content).not.toContain("周报生成 2");
    }
  });

  it("冲突且 AI 提议调用失败 → 重试一次后仍失败，同样挂 pending 请用户给新名", async () => {
    const createPersonalSkill = vi
      .fn()
      .mockRejectedValue(new SkillNameTakenError("conflict"));
    const namingComplete = vi
      .fn()
      .mockResolvedValueOnce(VALID_SKILL_MD)
      .mockRejectedValue(new Error("timeout"));
    const deps = makeDeps({
      chat: { complete: namingComplete },
      skills: { createPersonalSkill },
    });
    const outcome = await createSkillSummarizePipeline(deps).run(WORK);
    // 总结 1 次 + 提议重试 2 次。
    expect(namingComplete).toHaveBeenCalledTimes(3);
    expect(deps.store.upsertPending).toHaveBeenCalledWith(
      expect.objectContaining({ proposedName: "周报生成" }),
    );
    if (outcome.kind === "handled") {
      expect(outcome.content).toContain("请直接回复一个你想要的新名称");
    }
  });

  it("AI 首次提议失败、重试后可用 → 正常提议新名", async () => {
    const createPersonalSkill = vi
      .fn()
      .mockRejectedValue(new SkillNameTakenError("conflict"));
    const namingComplete = vi
      .fn()
      .mockResolvedValueOnce(VALID_SKILL_MD)
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce("周报小助手");
    const deps = makeDeps({
      chat: { complete: namingComplete },
      skills: { createPersonalSkill },
    });
    const outcome = await createSkillSummarizePipeline(deps).run(WORK);
    expect(deps.store.upsertPending).toHaveBeenCalledWith(
      expect.objectContaining({ proposedName: "周报小助手" }),
    );
    if (outcome.kind === "handled") {
      expect(outcome.content).toContain("周报小助手");
    }
  });

  it("保存抛非冲突异常 → 失败说明（不落 pending）", async () => {
    const deps = makeDeps({
      skills: {
        createPersonalSkill: vi
          .fn()
          .mockRejectedValue(new Error("db down")),
      },
    });
    const outcome = await createSkillSummarizePipeline(deps).run(WORK);
    if (outcome.kind === "handled") {
      expect(outcome.content).toContain("未创建技能");
    }
    expect(deps.store.upsertPending).not.toHaveBeenCalled();
  });
});

describe("确认模式（契约 §15.4）", () => {
  const pending = {
    draftContent: VALID_SKILL_MD,
    proposedName: "周报小助手",
  };
  function pendingDeps(chat: SkillSummarizeChatClient) {
    return makeDeps({
      chat,
      store: { findPending: vi.fn().mockResolvedValue(pending) },
    });
  }

  it("原样确认 → 用提议名重试保存成功并关闭会话", async () => {
    const deps = pendingDeps({
      complete: vi.fn().mockResolvedValue("[确认]"),
    });
    const outcome = await createSkillSummarizePipeline(deps).run({
      ...WORK,
      prompt: "确认",
    });
    expect(deps.skills.createPersonalSkill).toHaveBeenCalledWith("100", {
      name: "周报小助手",
      description: "根据要点生成周报",
      body: "# 步骤\n\n1. 收集要点\n2. 输出周报",
    });
    expect(deps.store.close).toHaveBeenCalledWith({
      conversationId: "7",
      userId: "100",
    });
    if (outcome.kind === "handled") {
      expect(outcome.content).toContain("周报小助手");
    }
  });

  it("改名确认 → 用新名保存", async () => {
    const deps = pendingDeps({
      complete: vi.fn().mockResolvedValue("[确认] 我的周报模板"),
    });
    await createSkillSummarizePipeline(deps).run({ ...WORK, prompt: "改名" });
    expect(deps.skills.createPersonalSkill).toHaveBeenCalledWith(
      "100",
      expect.objectContaining({ name: "我的周报模板" }),
    );
    expect(deps.store.close).toHaveBeenCalled();
  });

  it("确认后再次冲突 → 重新提议并继续保持 pending（不关闭）", async () => {
    const createPersonalSkill = vi
      .fn()
      .mockRejectedValue(new SkillNameTakenError("conflict"));
    const complete = vi
      .fn()
      .mockResolvedValueOnce("[确认]") // 解释用户回复
      .mockResolvedValueOnce("周报新名"); // 提议名
    const deps = makeDeps({
      chat: { complete },
      store: { findPending: vi.fn().mockResolvedValue(pending) },
      skills: { createPersonalSkill },
    });
    const outcome = await createSkillSummarizePipeline(deps).run({
      ...WORK,
      prompt: "确认",
    });
    expect(deps.store.upsertPending).toHaveBeenCalledWith(
      expect.objectContaining({ proposedName: "周报新名" }),
    );
    expect(deps.store.close).not.toHaveBeenCalled();
    if (outcome.kind === "handled") {
      expect(outcome.content).toContain("周报新名");
    }
  });

  it("确认后再冲突且 AI 提议失败 → pending 保持（proposedName 记占用名），请用户给新名", async () => {
    const createPersonalSkill = vi
      .fn()
      .mockRejectedValue(new SkillNameTakenError("conflict"));
    const complete = vi
      .fn()
      .mockResolvedValueOnce("[确认]") // 解释用户回复
      .mockRejectedValue(new Error("timeout")); // 提议名两次都失败
    const deps = makeDeps({
      chat: { complete },
      store: { findPending: vi.fn().mockResolvedValue(pending) },
      skills: { createPersonalSkill },
    });
    const outcome = await createSkillSummarizePipeline(deps).run({
      ...WORK,
      prompt: "确认",
    });
    expect(deps.store.upsertPending).toHaveBeenCalledWith(
      expect.objectContaining({ proposedName: "周报小助手" }),
    );
    expect(deps.store.close).not.toHaveBeenCalled();
    if (outcome.kind === "handled") {
      expect(outcome.content).toContain("请直接回复一个你想要的新名称");
    }
  });

  it("明确取消 → 关闭会话，确认未保存", async () => {
    const deps = pendingDeps({
      complete: vi.fn().mockResolvedValue("[取消]"),
    });
    const outcome = await createSkillSummarizePipeline(deps).run({
      ...WORK,
      prompt: "算了不要了",
    });
    expect(outcome).toEqual({
      kind: "handled",
      content: "已取消，未保存该技能。",
    });
    expect(deps.skills.createPersonalSkill).not.toHaveBeenCalled();
    expect(deps.store.close).toHaveBeenCalled();
  });

  it("无关回复 → 关闭会话并 pass_through（回退正常 runtime）", async () => {
    const deps = pendingDeps({
      complete: vi.fn().mockResolvedValue("[无关]"),
    });
    const outcome = await createSkillSummarizePipeline(deps).run({
      ...WORK,
      prompt: "顺便帮我画张海报",
    });
    expect(outcome).toEqual({ kind: "pass_through" });
    expect(deps.skills.createPersonalSkill).not.toHaveBeenCalled();
    expect(deps.store.close).toHaveBeenCalled();
  });

  it("确认模式 AI 失败 → 失败说明，保持 pending 等待用户继续回复", async () => {
    const deps = pendingDeps({
      complete: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const outcome = await createSkillSummarizePipeline(deps).run({
      ...WORK,
      prompt: "确认",
    });
    if (outcome.kind === "handled") {
      expect(outcome.content).toContain("未创建技能");
    }
    expect(deps.store.close).not.toHaveBeenCalled();
    expect(deps.store.upsertPending).not.toHaveBeenCalled();
  });

  it("确认回复无法解析 → 提示确认/取消，保持 pending", async () => {
    const deps = pendingDeps({
      complete: vi.fn().mockResolvedValue("我觉得都可以"),
    });
    const outcome = await createSkillSummarizePipeline(deps).run({
      ...WORK,
      prompt: "随便",
    });
    if (outcome.kind === "handled") {
      expect(outcome.content).toContain("没有理解你的回复");
    }
    expect(deps.store.close).not.toHaveBeenCalled();
  });

  it("pending 优先于总结意图（无论本条消息是否带 skill_summarize 都进确认模式）", async () => {
    const complete = vi.fn().mockResolvedValue("[确认]");
    const deps = pendingDeps({ complete });
    await createSkillSummarizePipeline(deps).run(WORK);
    // 走了确认模式：只调一次 AI（解释回复），未读会话历史。
    expect(complete).toHaveBeenCalledTimes(1);
    expect(deps.store.listRecentMessages).not.toHaveBeenCalled();
  });
});

describe("hasPending / 兜底管道 / env", () => {
  it("hasPending 透传 store.findPending", async () => {
    const deps = makeDeps();
    const pipeline = createSkillSummarizePipeline(deps);
    await expect(
      pipeline.hasPending({ conversationId: "7", userId: "100" }),
    ).resolves.toBe(false);
    expect(deps.store.findPending).toHaveBeenCalledWith({
      conversationId: "7",
      userId: "100",
    });
  });

  it("env 未配置兜底管道：总结意图返回失败说明，hasPending 恒 false", async () => {
    const pipeline = createUnavailableSkillSummarizePipeline();
    await expect(
      pipeline.hasPending({ conversationId: "7", userId: "100" }),
    ).resolves.toBe(false);
    const outcome = await pipeline.run(WORK);
    expect(outcome.kind).toBe("handled");
    if (outcome.kind === "handled") {
      expect(outcome.content).toContain("未创建技能");
    }
  });

  it("SKILL_SUMMARIZE_RULES 覆盖默认规则（纯空白视为未配置）", () => {
    expect(loadSkillSummarizeRules({})).toBe(DEFAULT_SKILL_SUMMARIZE_RULES);
    expect(loadSkillSummarizeRules({ SKILL_SUMMARIZE_RULES: "  " })).toBe(
      DEFAULT_SKILL_SUMMARIZE_RULES,
    );
    expect(loadSkillSummarizeRules({ SKILL_SUMMARIZE_RULES: "自定义" })).toBe(
      "自定义",
    );
  });
});

