import { describe, expect, it, vi } from "vitest";

import { createSkillFormatChatClient } from "./format-ai-client.js";
import {
  DEFAULT_SKILL_FORMAT_RULES,
  loadSkillFormatRules,
} from "./format-rules.js";

vi.mock("@blue-whale/agent-runtime", () => ({
  createControlledChatClient: vi.fn(),
}));
import { createControlledChatClient } from "@blue-whale/agent-runtime";

// format-ai 客户端是受控 chat 客户端（共用实现见 agent-runtime）的薄包装：
// 网络行为测试集中在 controlled-chat-client.test.ts，本文件只测包装层
// （draft → user 消息转换、options 委托透传）。固定规则测试保留。

const OPTIONS = {
  baseUrl: "http://new-api.test",
  token: "root-token",
  model: "test-model",
};

describe("createSkillFormatChatClient（薄包装）", () => {
  it("委托 createControlledChatClient：options 原样透传，draft 包装为 user 消息，返回值原样返回", async () => {
    const complete = vi.fn().mockResolvedValue("格式化后的 SKILL.md");
    vi.mocked(createControlledChatClient).mockReturnValue({
      complete,
    });

    const client = createSkillFormatChatClient({ ...OPTIONS });
    const out = await client.complete({ rules: "规则R", draft: "草稿D" });

    expect(out).toBe("格式化后的 SKILL.md");
    expect(createControlledChatClient).toHaveBeenCalledWith(OPTIONS);
    expect(complete).toHaveBeenCalledWith({
      rules: "规则R",
      messages: [{ role: "user", content: "草稿D" }],
    });
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
