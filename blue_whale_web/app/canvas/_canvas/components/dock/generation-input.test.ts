import { describe, expect, it } from "vitest";

import {
  selectDockInputAssetIds,
  selectVideoDockAssetIds,
} from "./generation-input";

describe("selectDockInputAssetIds", () => {
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
});
