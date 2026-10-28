import { describe, expect, it, vi } from "vitest";

import { handleSceneCardGenerate } from "./handle-scene-card-generate.js";
import { baseInput } from "../persistence/scene-card-generation-repo.test-helpers.js";


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

describe("handleSceneCardGenerate 计费接线（IKR60U）", () => {
  it("传入 billing → repo 收到同一份 charge/release 依赖", async () => {
    const { regenerateSceneCard, deps } = makeDeps({
      kind: "replayed",
      scene_card_id: "5001",
      generation_job_id: "9001",
      record_id: "8001",
    });
    const billing = { charge: vi.fn(), release: vi.fn() };

    const result = await handleSceneCardGenerate(
      "9",
      "55",
      "5001",
      "idem-3",
      BODY,
      deps,
      { billing },
    );

    expect(result.code).toBe(200);
    expect(regenerateSceneCard.mock.calls[0]![0].billing).toBe(billing);
  });
});

describe("handleSceneCardGenerate 素材门（IKFYHJ）", () => {
  it("门拒绝 → 1034 invalid_reference，原因原文外显", async () => {
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
      code: 1034,
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
