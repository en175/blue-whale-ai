import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createFakeAgentAdapter } from "./fake-agent-adapter.js";

describe("Fake Agent Adapter", () => {
  const request = (prompt: string) => ({
    prompt,
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
    });
  });

  it("selected Skill affects the response by pinned digest without exposing its body", async () => {
    const adapter = createFakeAgentAdapter();
    const result = await adapter.invoke({
      prompt: "海报专家",
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
