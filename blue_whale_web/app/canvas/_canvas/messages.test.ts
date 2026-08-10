import { describe, it, expect } from "vitest";
import { buildMockReply } from "./messages";

describe("buildMockReply", () => {
  it("返回 thinking → agent → card 的类型序列", () => {
    const reply = buildMockReply("画一只猫", () => 200);

    const types = reply.map((m) => m.type);

    // 首条 thinking，末条 card，中间为 agent
    expect(types[0]).toBe("thinking");
    expect(types[types.length - 1]).toBe("card");
    expect(types.slice(1, -1).every((t) => t === "agent")).toBe(true);
  });

  it("末条 card 形状：带 meta、text 非空、status 为 normal", () => {
    const reply = buildMockReply("画一只猫", () => 200);
    const card = reply[reply.length - 1];
    if (card.type !== "card") throw new Error("末条应为 card");

    expect(card.meta).toBe("1:1");
    expect(card.text.length).toBeGreaterThan(0);
    expect(card.status).toBe("normal");
  });
});
