import { describe, expect, it } from "vitest";
import { nodeToPendingMention } from "./mappers";
import type { CanvasNodeData } from "../model";

function makeNode(data: Partial<CanvasNodeData>) {
  return { id: "n1", data: { kind: "text", ...data } as CanvasNodeData };
}

const assets: Record<string, { src?: string } | undefined> = {
  "100": { src: "https://cdn/img.png" },
  "200": { src: "https://cdn/vid.mp4" },
  "300": { src: "https://cdn/ref.png" },
};

describe("nodeToPendingMention", () => {
  describe("media nodes (image/video/audio)", () => {
    it("maps image node with assetId to pill mention", () => {
      const node = makeNode({
        kind: "image",
        assetId: "100",
        content: "夕阳风景",
      });
      const result = nodeToPendingMention(node, assets, 1000);
      expect(result).toEqual({
        name: "夕阳风景",
        nonce: 1000,
        assetId: 100,
        src: "https://cdn/img.png",
        type: "image",
      });
    });

    it("maps video node with assetId to pill mention", () => {
      const node = makeNode({
        kind: "video",
        assetId: "200",
        content: "产品演示",
      });
      const result = nodeToPendingMention(node, assets, 1001);
      expect(result).toEqual({
        name: "产品演示",
        nonce: 1001,
        assetId: 200,
        src: "https://cdn/vid.mp4",
        type: "video",
      });
    });

    it("maps audio node without assetId to text fallback with default name", () => {
      const node = makeNode({ kind: "audio" });
      const result = nodeToPendingMention(node, assets, 1002);
      expect(result).toEqual({
        name: "音频",
        nonce: 1002,
        assetId: undefined,
        src: undefined,
        type: "audio",
      });
    });

    it("uses default name when content is empty", () => {
      const node = makeNode({ kind: "image", assetId: "100" });
      const result = nodeToPendingMention(node, assets, 1003);
      expect(result.name).toBe("图片");
    });
  });

  describe("reference cards", () => {
    it("maps reference card with referenceAssetId to pill mention", () => {
      const node = makeNode({
        kind: "reference",
        cardType: "style",
        name: "赛博朋克风",
        referenceAssetId: "300",
      });
      const result = nodeToPendingMention(node, assets, 2000);
      expect(result).toEqual({
        name: "赛博朋克风",
        nonce: 2000,
        assetId: 300,
        src: "https://cdn/ref.png",
        type: "image",
      });
    });

    it("uses card type label as fallback name", () => {
      const node = makeNode({
        kind: "reference",
        cardType: "character",
        referenceAssetId: "300",
      });
      const result = nodeToPendingMention(node, assets, 2001);
      expect(result.name).toBe("角色卡");
    });

    it("maps reference card without asset to text mention", () => {
      const node = makeNode({
        kind: "reference",
        cardType: "environment",
        name: "森林场景",
      });
      const result = nodeToPendingMention(node, assets, 2002);
      expect(result).toEqual({
        name: "森林场景",
        nonce: 2002,
        assetId: undefined,
        src: undefined,
        type: "image",
      });
    });

    it("handles non-numeric referenceAssetId gracefully", () => {
      const node = makeNode({
        kind: "reference",
        cardType: "product",
        name: "商品A",
        referenceAssetId: "libimg-abc",
      });
      const result = nodeToPendingMention(node, assets, 2003);
      expect(result.assetId).toBeUndefined();
      expect(result.src).toBeUndefined();
      expect(result.name).toBe("商品A");
    });
  });

  describe("text nodes", () => {
    it("maps text node to plain text mention", () => {
      const node = makeNode({ kind: "text", content: "剧情大纲" });
      const result = nodeToPendingMention(node, assets, 3000);
      expect(result).toEqual({
        name: "剧情大纲",
        nonce: 3000,
      });
    });

    it("uses default name for empty text node", () => {
      const node = makeNode({ kind: "text" });
      const result = nodeToPendingMention(node, assets, 3001);
      expect(result.name).toBe("文本");
    });
  });

  describe("batch nonce", () => {
    it("assigns unique nonce per node in batch", () => {
      const nodes = [
        makeNode({ kind: "image", assetId: "100", content: "A" }),
        makeNode({ kind: "text", content: "B" }),
        makeNode({ kind: "reference", cardType: "object", name: "C" }),
      ];
      const baseNonce = 5000;
      const results = nodes.map((n, i) =>
        nodeToPendingMention(n, assets, baseNonce + i),
      );
      expect(results[0].nonce).toBe(5000);
      expect(results[1].nonce).toBe(5001);
      expect(results[2].nonce).toBe(5002);
    });
  });
});
