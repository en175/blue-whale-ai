import { describe, expect, it } from "vitest";

import { selectDockInputAssetIds } from "./generation-input";

describe("selectDockInputAssetIds", () => {
  it("keeps unique image references from mentions and Dock media", () => {
    expect(
      selectDockInputAssetIds("image", [9], [{ assetId: "10" }, { assetId: "9" }]),
    ).toEqual([9, 10]);
  });

  it("uses one first-frame or image reference for image-to-video", () => {
    expect(
      selectDockInputAssetIds("video", [12], [{ assetId: "13" }], [11]),
    ).toEqual([11]);
  });
});
