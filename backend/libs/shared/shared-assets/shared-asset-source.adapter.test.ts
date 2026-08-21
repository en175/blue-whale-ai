import { describe, expect, it, vi } from "vitest";
import { SharedAssetSourceAdapter } from "./shared-asset-source.adapter.js";

/** 端口适配器参数顺序测试：SceneCardResourceService 签名是 (userId, sceneCardId)，
 *  曾因透传顺序写反导致场景卡保存必挂（IK9QKP reviewer round2），此测试钉死回归。 */
describe("SharedAssetSourceAdapter（端口参数顺序）", () => {
  it("findOwnedSource 按 (sourceAssetId, userId) 透传", async () => {
    const assets = { findOwnedSource: vi.fn().mockResolvedValue({ type: "image" }) };
    const adapter = new SharedAssetSourceAdapter(assets as never, {} as never);
    await adapter.findOwnedSource("42", "1");
    expect(assets.findOwnedSource).toHaveBeenCalledWith("42", "1");
  });

  it("findOwnedSceneCard 按 (userId, sceneCardId) 透传", async () => {
    const sceneCard = {
      findOwnedSceneCardWithPreset: vi
        .fn()
        .mockResolvedValue({ kind: "found" }),
    };
    const adapter = new SharedAssetSourceAdapter({} as never, sceneCard as never);
    await adapter.findOwnedSceneCard("7", "1");
    expect(sceneCard.findOwnedSceneCardWithPreset).toHaveBeenCalledWith("1", "7");
  });

  it("copySceneCardToProject 原样透传 input", async () => {
    const sceneCard = { copySceneCardToProject: vi.fn().mockResolvedValue({ kind: "copied" }) };
    const input = { userId: "1", projectId: "9", title: "t" };
    const adapter = new SharedAssetSourceAdapter({} as never, sceneCard as never);
    await adapter.copySceneCardToProject(input as never);
    expect(sceneCard.copySceneCardToProject).toHaveBeenCalledWith(input);
  });
});
