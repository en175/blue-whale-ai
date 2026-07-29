import { describe, expect, it } from "vitest";

import { selectDockInputAssetIds } from "./generation-input";

describe("selectDockInputAssetIds", () => {
  it("keeps unique image references from mentions and Dock media", () => {
    expect(
      selectDockInputAssetIds("image", [9], [{ assetId: "10" }, { assetId: "9" }]),
    ).toEqual([9, 10]);
  });

  it("preserves all selected video asset identities for explicit role mapping", () => {
    expect(
      selectDockInputAssetIds("video", [12], [{ assetId: "13" }, { assetId: "14" }], [11]),
    ).toEqual([11, 12, 13, 14]);
  });
});
