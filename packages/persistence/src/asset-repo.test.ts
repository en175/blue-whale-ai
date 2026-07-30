import { describe, expect, it } from "vitest";

import { assetDurationSeconds } from "./asset-repo";

describe("assetDurationSeconds", () => {
  it("prefers precise milliseconds and falls back to whole seconds", () => {
    expect(assetDurationSeconds(66, 65_900)).toBe(65.9);
    expect(assetDurationSeconds(66, null)).toBe(66);
    expect(assetDurationSeconds(null, null)).toBeNull();
  });
});
