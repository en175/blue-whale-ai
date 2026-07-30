import { describe, expect, it } from "vitest";

import {
  selectDockInputAssetIds,
  selectVideoDockAssetIds,
  validateImageDockReferences,
  validateVideoDockReferences,
} from "./generation-input";

describe("selectDockInputAssetIds", () => {
  it("keeps a large asset identity as its precise decimal string", () => {
    const assetId = "9007199254740993";
    expect(
      selectDockInputAssetIds("video", [assetId], [{ assetId }], [assetId]),
    ).toEqual([assetId]);
  });

  it("keeps unique image references from mentions and Dock media", () => {
    expect(
      selectDockInputAssetIds("image", [9], [{ assetId: "10" }, { assetId: "9" }]),
    ).toEqual([9, 10]);
  });

  it("preserves all selected video asset identities for explicit role mapping", () => {
    expect(
      selectDockInputAssetIds("video", [12], [
        { assetId: "13", type: "image" },
        { assetId: "14", type: "video" },
        { assetId: "15", type: "audio" },
      ]),
    ).toEqual([12, 13, 14]);
  });

  it("keeps up to twelve ordered image and video references", () => {
    const media = Array.from({ length: 13 }, (_, index) => ({
      assetId: String(index + 1),
      type: index % 2 === 0 ? "image" as const : "video" as const,
    }));
    expect(selectDockInputAssetIds("video", [], media)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
  });

  it("keeps frame mode and ordinary reference mode mutually exclusive", () => {
    const media = [
      { assetId: "13", type: "image" as const },
      { assetId: "14", type: "video" as const },
    ];
    expect(
      selectVideoDockAssetIds("omni", [12], media),
    ).toEqual({
      referenceAssetIds: [12, 13, 14],
    });
    expect(
      selectVideoDockAssetIds("first-last", [12], media),
    ).toEqual({
      referenceAssetIds: [],
    });
  });

  it("accepts one to four image references and rejects the fifth", () => {
    expect(
      validateImageDockReferences(
        [1, 2],
        [
          { assetId: "3", type: "image" },
          { assetId: "4", type: "image" },
        ],
      ),
    ).toBeNull();
    expect(
      validateImageDockReferences(
        [1, 2],
        [
          { assetId: "3", type: "image" },
          { assetId: "4", type: "image" },
          { assetId: "5", type: "image" },
        ],
      ),
    ).toBe("图片生成最多支持 4 张参考图");
  });

  it("rejects references when the selected image model does not support edits", () => {
    expect(
      validateImageDockReferences(
        [1],
        [],
        false,
      ),
    ).toBe("当前模型不支持参考图");
  });

  it("enforces nine image and three video references", () => {
    const images = Array.from({ length: 10 }, (_, index) => ({
      assetId: String(index + 1),
      type: "image" as const,
    }));
    const videos = Array.from({ length: 4 }, (_, index) => ({
      assetId: String(index + 101),
      type: "video" as const,
    }));

    expect(validateVideoDockReferences("omni", [], images)).toBe(
      "视频生成最多支持 9 张参考图",
    );
    expect(validateVideoDockReferences("omni", [], videos)).toBe(
      "视频生成最多支持 3 个参考视频",
    );
  });

  it("requires a first frame before a last frame", () => {
    expect(
      validateVideoDockReferences("first-last", [], [], {
        firstFrameAssetId: undefined,
        lastFrameAssetId: 42,
      }),
    ).toBe("请先添加首帧，再添加尾帧");
    expect(
      validateVideoDockReferences("first-last", [], [], {
        firstFrameAssetId: 41,
        lastFrameAssetId: 42,
      }),
    ).toBeNull();
  });
});
