import { describe, expect, it, vi } from "vitest";
import { SharedAssetSourceAdapter } from "./shared-asset-source.adapter.js";

describe("SharedAssetSourceAdapter（端口参数顺序）", () => {
  it("findOwnedSource 按 (sourceAssetId, userId) 透传", async () => {
    const assets = { findOwnedSource: vi.fn().mockResolvedValue({ type: "image" }) };
    const adapter = new SharedAssetSourceAdapter(assets as never);
    await adapter.findOwnedSource("42", "1");
    expect(assets.findOwnedSource).toHaveBeenCalledWith("42", "1");
  });
});
