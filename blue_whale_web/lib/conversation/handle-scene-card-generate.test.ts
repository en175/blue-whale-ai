import {
  ASSET_UNAVAILABLE_CODE,
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  PLAN_APPLICATION_CAPABILITY_DRIFT_CODE,
  RESOURCE_NOT_FOUND_CODE,
  SCENE_CARD_VERSION_CONFLICT_CODE,
} from "@blue-whale/contracts";
import type { SceneCardGenerationRepo } from "@blue-whale/persistence";
import { describe, expect, it, vi } from "vitest";

import { handleSceneCardGenerate } from "./handle-scene-card-generate";

const BODY = JSON.stringify({
  scene_card_id: "5001",
  base_scene_card_version: 1,
  base_preset_version: 1,
  parameters: {
    capability_type: "video",
    model_id: "doubao-seedance-1.0",
    provider_id: "doubao",
    size: "1280x720",
    aspect_ratio: "16:9",
    format: null,
    duration: 5,
    count: 1,
  },
  reference_mode: "text_to_video",
  reference_assets: [],
  capability_snapshot_version: {
    schema_version: 1,
    capability_type: "video",
    model_id: "doubao-seedance-1.0",
    provider_id: "doubao",
    row_version: 3,
    digest: `sha256:${"a".repeat(64)}`,
  },
});

function deps(result: unknown): SceneCardGenerationRepo {
  return {
    regenerateSceneCard: vi.fn().mockResolvedValue(result),
    getSceneCardGenerationPreset: vi.fn(),
  } as unknown as SceneCardGenerationRepo;
}

describe("handleSceneCardGenerate（IK67HB / T13）", () => {
  it("缺少 Idempotency-Key 返回 100000", async () => {
    const result = await handleSceneCardGenerate(
      "100",
      "42",
      "5001",
      null,
      BODY,
      deps({}),
    );
    expect(result.code).toBe(PARAM_MISSING_CODE);
  });

  it("sceneCardId 非十进制返回 100301", async () => {
    const result = await handleSceneCardGenerate(
      "100",
      "42",
      "abc",
      "key-1",
      BODY,
      deps({}),
    );
    expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
  });

  it("body 非法 JSON 返回 400", async () => {
    const result = await handleSceneCardGenerate(
      "100",
      "42",
      "5001",
      "key-1",
      "{not json",
      deps({}),
    );
    expect(result.code).toBe(400);
  });

  it("body 缺必填字段返回 400", async () => {
    const result = await handleSceneCardGenerate(
      "100",
      "42",
      "5001",
      "key-1",
      JSON.stringify({ scene_card_id: "5001" }),
      deps({}),
    );
    expect(result.code).toBe(400);
  });

  it("body.scene_card_id 与 URL 不符返回 400", async () => {
    const mismatchBody = JSON.stringify({
      ...JSON.parse(BODY),
      scene_card_id: "5002",
    });
    const result = await handleSceneCardGenerate(
      "100",
      "42",
      "5001",
      "key-1",
      mismatchBody,
      deps({}),
    );
    expect(result.code).toBe(400);
  });

  it("成功再生成返回 scene_card_id/generation_job_id/record_id/preset_version", async () => {
    const result = await handleSceneCardGenerate(
      "100",
      "42",
      "5001",
      "key-1",
      BODY,
      deps({
        kind: "applied",
        scene_card_id: "5001",
        generation_job_id: "9001",
        record_id: "8001",
        preset_version: 2,
        cursor: "100",
      }),
    );
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({
      scene_card_id: 5001,
      generation_job_id: 9001,
      record_id: 8001,
      preset_version: 2,
    });
  });

  it("重放返回首次结果（不含 record_id/cursor）", async () => {
    const result = await handleSceneCardGenerate(
      "100",
      "42",
      "5001",
      "key-1",
      BODY,
      deps({
        kind: "replayed",
        scene_card_id: "5001",
        generation_job_id: "9001",
      }),
    );
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({
      scene_card_id: 5001,
      generation_job_id: 9001,
    });
  });

  it("idempotency_conflict 映射 100302", async () => {
    const result = await handleSceneCardGenerate(
      "100",
      "42",
      "5001",
      "key-1",
      BODY,
      deps({ kind: "idempotency_conflict" }),
    );
    expect(result.code).toBe(IDEMPOTENCY_KEY_REUSED_CODE);
  });

  it("scene_card_not_found 映射 100301", async () => {
    const result = await handleSceneCardGenerate(
      "100",
      "42",
      "5001",
      "key-1",
      BODY,
      deps({ kind: "scene_card_not_found" }),
    );
    expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
  });

  it("version_conflict 映射 100405 并附当前双版本", async () => {
    const result = await handleSceneCardGenerate(
      "100",
      "42",
      "5001",
      "key-1",
      BODY,
      deps({
        kind: "version_conflict",
        current_scene_card_version: 2,
        current_preset_version: 2,
      }),
    );
    expect(result.code).toBe(SCENE_CARD_VERSION_CONFLICT_CODE);
    expect(result.data).toMatchObject({
      current_scene_card_version: 2,
      current_preset_version: 2,
    });
  });

  it("capability_drift 映射 100403", async () => {
    const result = await handleSceneCardGenerate(
      "100",
      "42",
      "5001",
      "key-1",
      BODY,
      deps({ kind: "capability_drift" }),
    );
    expect(result.code).toBe(PLAN_APPLICATION_CAPABILITY_DRIFT_CODE);
  });

  it("capability_limit（参数越界）映射 400", async () => {
    const result = await handleSceneCardGenerate(
      "100",
      "42",
      "5001",
      "key-1",
      BODY,
      deps({ kind: "capability_limit", reason: "aspect_ratio 不在范围" }),
    );
    expect(result.code).toBe(400);
  });

  it("validation_failed 映射素材失效 100202", async () => {
    const result = await handleSceneCardGenerate(
      "100",
      "42",
      "5001",
      "key-1",
      BODY,
      deps({ kind: "validation_failed", reason: "x" }),
    );
    expect(result.code).toBe(ASSET_UNAVAILABLE_CODE);
  });

  it("forbidden（项目不归属）映射 100301，不泄漏存在性", async () => {
    const result = await handleSceneCardGenerate(
      "100",
      "42",
      "5001",
      "key-1",
      BODY,
      deps({ kind: "forbidden" }),
    );
    expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
  });

  it("requestHash 随 body 变化（同 key 不同 body 判冲突的基础）", async () => {
    const mock = vi.fn().mockResolvedValue({ kind: "scene_card_not_found" });
    const repo = {
      regenerateSceneCard: mock,
      getSceneCardGenerationPreset: vi.fn(),
    } as unknown as SceneCardGenerationRepo;
    await handleSceneCardGenerate("100", "42", "5001", "key-1", BODY, repo);
    const body2 = JSON.stringify({
      ...JSON.parse(BODY),
      base_preset_version: 2,
    });
    await handleSceneCardGenerate("100", "42", "5001", "key-1", body2, repo);
    const [firstHash, secondHash] = [
      mock.mock.calls[0][0].requestHash,
      mock.mock.calls[1][0].requestHash,
    ];
    expect(firstHash).not.toBe(secondHash);
    expect(firstHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
