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
});
