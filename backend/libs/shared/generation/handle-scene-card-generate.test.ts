import { describe, expect, it, vi } from "vitest";

import { handleSceneCardGenerate } from "./handle-scene-card-generate.js";
import { baseInput } from "../persistence/scene-card-generation-repo.test-helpers.js";

// IKF YHJ：场景卡再生成是第三条视频创建路径。这里只钉握手——门的拒绝原因必须以
// 400 + invalid_reference 返回（与创建期/重试期同款），不落成 404/500。

/** 合法请求体：parameters 与 capability_snapshot_version 直接取自 repo 测试用的那份
 *  已验证取值（schema 的 superRefine 要求两者 capability_type/model_id/provider_id 一致），
 *  自己手搓容易漏字段、把测试变成在测 schema 而不是测门。 */
const BODY = JSON.stringify({
  scene_card_id: baseInput.sceneCardId,
  base_scene_card_version: baseInput.base_scene_card_version,
  base_preset_version: baseInput.base_preset_version,
  parameters: baseInput.parameters,
  reference_mode: baseInput.reference_mode,
  reference_assets: baseInput.reference_assets,
  capability_snapshot_version: baseInput.capability_snapshot_version,
});

function makeDeps(result: unknown) {
  const regenerateSceneCard = vi.fn().mockResolvedValue(result);
  return { regenerateSceneCard, deps: { regenerateSceneCard } as never };
}

describe("handleSceneCardGenerate 素材门（IKFYHJ）", () => {
  it("门拒绝 → 400 + invalid_reference，原因原文外显", async () => {
    const { deps } = makeDeps({
      kind: "material_blocked",
      reason: "该素材未审核通过，不能用于视频生成",
    });

    const result = await handleSceneCardGenerate(
      "9",
      "55",
      "5001",
      "idem-1",
      BODY,
      deps,
    );

    expect(result).toEqual({
      code: 400,
      msg: "该素材未审核通过，不能用于视频生成",
      data: { code: "invalid_reference" },
    });
  });

  it("把门包成 guardInput 交给 repo（由 repo 决定何时调，只在事务内、建 job 之前）", async () => {
    const assertInputUsable = vi.fn().mockResolvedValue(null);
    const { regenerateSceneCard, deps } = makeDeps({
      kind: "applied",
      scene_card_id: "5001",
      generation_job_id: "9001",
      record_id: "8001",
      preset_version: 2,
      cursor: "7",
    });

    const result = await handleSceneCardGenerate(
      "9",
      "55",
      "5001",
      "idem-2",
      BODY,
      deps,
      { materialGate: { assertInputUsable } },
    );

    expect(result.code).toBe(200);
    const guardInput = regenerateSceneCard.mock.calls[0]![0].guardInput;
    expect(guardInput).toBeTypeOf("function");

    const jobInput = { reference_asset_ids: ["990001"] };
    await expect(guardInput(jobInput)).resolves.toBeNull();
    // 场景卡这条入口只建视频 job，所以类型恒为 video。
    expect(assertInputUsable).toHaveBeenCalledWith({
      userId: "9",
      jobInput,
      jobType: "video",
    });
  });

  it("未接线时不传 guardInput（repo 走改造前老路）", async () => {
    const { regenerateSceneCard, deps } = makeDeps({
      kind: "applied",
      scene_card_id: "5001",
      generation_job_id: "9001",
      record_id: "8001",
      preset_version: 2,
      cursor: "7",
    });

    await handleSceneCardGenerate("9", "55", "5001", "idem-3", BODY, deps);

    expect(regenerateSceneCard.mock.calls[0]![0].guardInput).toBeUndefined();
  });
});
