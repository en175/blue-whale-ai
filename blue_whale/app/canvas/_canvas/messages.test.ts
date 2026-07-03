import { describe, it, expect } from "vitest";
import { buildMockReplyForMode } from "./messages";

describe("buildMockReplyForMode", () => {
  describe("Direct Gen 模式", () => {
    it("仅返回一张 card，不含 thinking/agent", () => {
      const reply = buildMockReplyForMode("direct", "画一只猫", () => 100);

      expect(reply).toHaveLength(1);
      expect(reply[0].type).toBe("card");
    });
  });

  describe("Agent 模式", () => {
    it("返回 thinking → agent → card 的类型序列", () => {
      const reply = buildMockReplyForMode("agent", "画一只猫", () => 200);

      const types = reply.map((m) => m.type);

      // 首条 thinking，末条 card，中间为 agent
      expect(types[0]).toBe("thinking");
      expect(types[types.length - 1]).toBe("card");
      expect(types.slice(1, -1).every((t) => t === "agent")).toBe(true);
    });

    it("两种模式的末条 card 形状一致：带 meta、text 非空、status 为 normal", () => {
      const direct = buildMockReplyForMode("direct", "画一只猫", () => 100);
      const agent = buildMockReplyForMode("agent", "画一只猫", () => 200);

      for (const reply of [direct, agent]) {
        const card = reply[reply.length - 1];
        if (card.type !== "card") throw new Error("末条应为 card");

        expect(card.meta).toBe("1:1");
        expect(card.text.length).toBeGreaterThan(0);
        expect(card.status).toBe("normal");
      }
    });

    it("Direct Gen card 文案基于用户输入派生，而非原样回灌", () => {
      const reply = buildMockReplyForMode("direct", "画一只猫", () => 100);
      const card = reply[0];
      if (card.type !== "card") throw new Error("应为 card");

      // 文案包含用户原始输入（读取了输入）
      expect(card.text).toContain("画一只猫");
      // 文案带有生成痕迹，证明是派生而非原样复制
      expect(card.text).not.toBe("画一只猫");
    });
  });
});
