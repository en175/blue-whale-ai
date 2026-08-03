import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createFakeAgentAdapter } from "./fake-agent-adapter.js";

describe("Fake Agent Adapter", () => {
  it("同一输入产生稳定的候选文字", async () => {
    const adapter = createFakeAgentAdapter();

    await expect(adapter.invoke({ prompt: "hello" })).resolves.toEqual({
      provider: "fake",
      content:
        "fake-agent-response:05d37bdcd85047a772a96d21d5b472781d711e3c423e989b26da887c07895ac1",
    });
  });

  it("fake:failure 标记抛出明确失败", async () => {
    const adapter = createFakeAgentAdapter();

    await expect(
      adapter.invoke({ prompt: "请失败 fake:failure" }),
    ).rejects.toThrow("fake agent explicit failure");
  });

  it("fake:delay 标记挂起后仍返回确定性回显", async () => {
    const adapter = createFakeAgentAdapter();
    const prompt = "慢一点 fake:delay:120";

    const started = Date.now();
    const result = await adapter.invoke({ prompt });
    expect(Date.now() - started).toBeGreaterThanOrEqual(120);

    const fingerprint = createHash("sha256")
      .update(`blue-whale-agent-fake-v1\n${prompt}`)
      .digest("hex");
    expect(result).toEqual({
      provider: "fake",
      content: `fake-agent-response:${fingerprint}`,
    });
  });
});
