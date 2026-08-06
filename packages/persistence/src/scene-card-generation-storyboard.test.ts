import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  baseInput,
  buildTx,
  CAPABILITY_SNAPSHOT,
  CAP_FIELDS,
  capabilityDigest,
  repoWith,
} from "./scene-card-generation-repo.test-helpers.js";

describe("SceneCardGenerationRepo.regenerateSceneCard storyboard frames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("IK70LQ 画格作首帧：slot→asset_id 解析并入 job.input 扁平字段（AC#3/#4）", async () => {
    const capFields = { ...CAP_FIELDS, features: { first_frame: true } };
    const tx = buildTx({
      generation_model_capability: {
        findUnique: vi.fn().mockResolvedValue({
          version: 3,
          enabled: true,
          is_delete: false,
          ...capFields,
        }),
      },
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 9101n,
            asset_id: 3001n,
            status: "succeeded",
            generation_job_id: 8001n,
          },
        ]),
      },
      storyboard_previews: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ first_generation_job_id: 8001n }]),
      },
      assets: {
        findMany: vi.fn().mockResolvedValue([{ id: 3001n }]),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_mode: "first_frame",
      reference_assets: [
        { slot_id: "9101", type: "storyboard_frame", role: "first_frame" },
      ],
      capability_snapshot_version: {
        ...CAPABILITY_SNAPSHOT,
        digest: capabilityDigest(CAP_FIELDS),
      },
    });

    expect(result.kind).toBe("applied");
    expect(tx.generation_jobs.create.mock.calls[0][0].data.input).toMatchObject({
      first_frame_asset_id: "3001",
      reference_mode: "first_frame",
    });
  });

  it("IK70LQ 画格组允许改 role，mention 组身份锁不拦画格（AC#5）", async () => {
    const capFields = { ...CAP_FIELDS, features: { first_frame: true } };
    const tx = buildTx({
      generation_model_capability: {
        findUnique: vi.fn().mockResolvedValue({
          version: 3,
          enabled: true,
          is_delete: false,
          ...capFields,
        }),
      },
      scene_card_generation_presets: {
        findFirst: vi.fn().mockResolvedValue({
          id: 6001n,
          version: 1,
          reference_assets: [
            { slot_id: "9101", type: "storyboard_frame", role: "reference" },
          ],
        }),
      },
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 9101n,
            asset_id: 3001n,
            status: "succeeded",
            generation_job_id: 8001n,
          },
        ]),
      },
      storyboard_previews: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ first_generation_job_id: 8001n }]),
      },
      assets: {
        findMany: vi.fn().mockResolvedValue([{ id: 3001n }]),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_mode: "first_frame",
      reference_assets: [
        { slot_id: "9101", type: "storyboard_frame", role: "first_frame" },
      ],
      capability_snapshot_version: {
        ...CAPABILITY_SNAPSHOT,
        digest: capabilityDigest(CAP_FIELDS),
      },
    });

    expect(result.kind).toBe("applied");
    expect(tx.generation_jobs.create.mock.calls[0][0].data.input).toMatchObject({
      first_frame_asset_id: "3001",
    });
  });

  it("IK70LQ 画格不属于本场景卡的分镜预览时零写入（AC#4）", async () => {
    const tx = buildTx({
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 9101n,
            asset_id: 3001n,
            status: "succeeded",
            generation_job_id: 8001n,
          },
        ]),
      },
      storyboard_previews: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_assets: [
        { slot_id: "9101", type: "storyboard_frame", role: "reference" },
      ],
    });

    expect(result).toEqual({
      kind: "validation_failed",
      reason: "画格 9101 不属于该场景卡的分镜预览",
    });
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
  });

  it("IK70LQ 模型不支持首帧时画格作首帧零写入（capability_limit，AC#4）", async () => {
    const tx = buildTx({
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 9101n,
            asset_id: 3001n,
            status: "succeeded",
            generation_job_id: 8001n,
          },
        ]),
      },
      storyboard_previews: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ first_generation_job_id: 8001n }]),
      },
      assets: {
        findMany: vi.fn().mockResolvedValue([{ id: 3001n }]),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_mode: "first_frame",
      reference_assets: [
        { slot_id: "9101", type: "storyboard_frame", role: "first_frame" },
      ],
    });

    expect(result).toMatchObject({ kind: "capability_limit" });
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
  });
});
