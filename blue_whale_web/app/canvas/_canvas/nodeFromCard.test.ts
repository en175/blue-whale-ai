import { describe, it, expect } from "vitest";
import { nodeFromCard } from "./nodeFromCard";
import type { CardMessage } from "./nodeFromCard";

const FIXED_ID = "fixed-id-42";
const idGen = () => FIXED_ID;

function makeCard(overrides: Partial<CardMessage> = {}): CardMessage {
  return {
    id: 1,
    type: "card",
    text: "赛博朋克城市夜景",
    meta: "1:1",
    status: "normal",
    ...overrides,
  };
}

describe("nodeFromCard", () => {
  it("产出 image 类型节点", () => {
    const node = nodeFromCard(makeCard(), idGen);

    expect(node.type).toBe("image");
  });

  it("content 取 card.text 作标题", () => {
    const node = nodeFromCard(makeCard({ text: "画一只猫" }), idGen);

    expect(node.content).toBe("画一只猫");
  });

  it("宽高由 meta 派生（16:9 → 427×240，独立算出）", () => {
    const node = nodeFromCard(makeCard({ meta: "16:9" }), idGen);

    // 期望值独立算出：round(240 * 16 / 9) = 427
    expect(node.width).toBe(427);
    expect(node.height).toBe(240);
  });

  it("把 card 的 asset_id 与受控图片地址原样交给 NodeItem", () => {
    const node = nodeFromCard(
      makeCard({ assetId: "asset-9", imageUrl: "/assets/9/content" }),
      idGen,
    );

    expect(node.assetId).toBe("asset-9");
    expect(node.imageUrl).toBe("/assets/9/content");
  });

  it("id 来自注入的 idGen（验注入生效，非硬编码）", () => {
    const node = nodeFromCard(makeCard(), idGen);

    expect(node.id).toBe(FIXED_ID);
  });

  it("未知 meta 回退传导到 240×240", () => {
    const node = nodeFromCard(makeCard({ meta: "横向" }), idGen);

    expect(node).toMatchObject({ width: 240, height: 240 });
  });
});
