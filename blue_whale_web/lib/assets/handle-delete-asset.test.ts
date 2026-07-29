import { describe, expect, it, vi } from "vitest";

import { handleDeleteAsset } from "./handle-delete-asset";

describe("handleDeleteAsset", () => {
  it("soft-deletes an Asset owned by the current user", async () => {
    const assets = { softDeleteOwned: vi.fn().mockResolvedValue(true) };

    const result = await handleDeleteAsset("9", "42", { assets });

    expect(result).toEqual({ code: 200, msg: null, data: null });
    expect(assets.softDeleteOwned).toHaveBeenCalledWith("42", "9");
  });

  it("returns resource-not-found for a missing or foreign Asset", async () => {
    const assets = { softDeleteOwned: vi.fn().mockResolvedValue(false) };

    const result = await handleDeleteAsset("9", "42", { assets });

    expect(result).toMatchObject({ code: 100301, data: null });
  });
});
