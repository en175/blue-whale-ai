import { describe, expect, it, vi } from "vitest";

import { handleStoryboardPreviewCreate, storyboardPreviewRequestHash } from "./handle-storyboard-preview-create.js";
import { RecoveryContractError, type StoryboardPreviewRepo } from "@lib/shared/persistence/index.js";
import type { CanvasBinding } from "@lib/contracts";

/** IKJJR0（IKIXK9-SPEC-20261002 B.3）：成片（分镜预览）入口接入统一关联受理的 handler 面。
 *
 *  repo 事务行为（锁内回读、归属版本核对、关联行写入）由真实库集成测试覆盖
 *  （ikjjr0-canvas-recovery.integration.test.ts）；此处验证：
 *  受理数据组装、幂等承载一致性校验（B.8）、受控错误信封直返、受理/重放响应同形。 */

const UUID = "0a1b2c3d-0000-4000-8000-000000000011";

function binding(submissionId: string, node = "scene-node-1"): CanvasBinding {
  return {
    protocol_version: 1,
    submission_id: submissionId,
    target_node_id: node,
    expected_binding_revision: 0,
    recovery_seed: {
      target: { role: "result-placeholder", x: 0, y: 0, width: 100, height: 100, name: "" },
      sources: [],
    },
  };
}

const BASE_BODY = {
  scene_card_id: "5001",
  base_scene_card_version: 1,
  parameters: { model_id: "seedream-4", size: "2k", aspect_ratio: "16:9", count: 4 },
  capability_snapshot_version: {
    schema_version: 1,
    capability_type: "image",
    model_id: "seedream-4",
    provider_id: "volc",
    row_version: 3,
    digest: `sha256:${"a".repeat(64)}`,
  },
};

const BINDING_VIEW = {
  protocol_version: 1,
  submission_id: UUID,
  target_node_id: "scene-node-1",
  binding_revision: 1,
  job_id: "8101",
  is_current: true,
};

function buildRepo(result: unknown, view: unknown = BINDING_VIEW) {
  return {
    createStoryboardPreview: vi.fn().mockResolvedValue(result),
    canvasBindingView: vi.fn().mockResolvedValue(view),
    listStoryboardPreviews: vi.fn(),
    listStoryboardFrames: vi.fn(),
  } as unknown as StoryboardPreviewRepo & {
    createStoryboardPreview: ReturnType<typeof vi.fn>;
    canvasBindingView: ReturnType<typeof vi.fn>;
  };
}

const OPTIONS = { providerCredential: "sk-plain" };

function requestBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...BASE_BODY, ...overrides });
}

describe("handleStoryboardPreviewCreate canvas_binding（IKJJR0）", () => {
  it("★ 携带 canvas_binding → 统一关联受理：repo 收到 acceptance（operation/taskType/摘要同源），响应带绑定视图", async () => {
    const repo = buildRepo({
      kind: "applied",
      preview_id: "7001",
      scene_card_id: "5001",
      generation_job_id: "8101",
      cursor: "42",
    });

    const res = await handleStoryboardPreviewCreate(
      "42", "1", "5001", UUID, requestBody({ canvas_binding: binding(UUID) }), repo, OPTIONS,
    );

    expect(res.code).toBe(200);
    expect(res.data).toMatchObject({
      preview_id: 7001,
      generation_job_id: 8101,
      canvas_binding: BINDING_VIEW,
    });
    const input = repo.createStoryboardPreview.mock.calls[0]![0];
    expect(input.canvasRecovery).toMatchObject({
      projectId: "1",
      userId: "42",
      operation: "scene_card.storyboard_preview",
      taskType: "image",
      idempotencyKey: UUID,
      requestHash: storyboardPreviewRequestHash("1", "5001", requestBody({ canvas_binding: binding(UUID) })),
    });
    expect(input.canvasRecovery.binding).toEqual(binding(UUID));
  });

  it("★ 幂等承载不一致（Idempotency-Key ≠ submission_id）→ 400 invalid_recovery_payload，零受理", async () => {
    const repo = buildRepo({ kind: "applied", preview_id: "7001", scene_card_id: "5001", generation_job_id: "8101", cursor: "42" });

    const res = await handleStoryboardPreviewCreate(
      "42", "1", "5001", "another-key", requestBody({ canvas_binding: binding(UUID) }), repo, OPTIONS,
    );

    expect(res).toMatchObject({ code: 400, data: { reason: "invalid_recovery_payload" } });
    expect(repo.createStoryboardPreview).not.toHaveBeenCalled();
  });

  it("★ canvas_binding 载荷非法 → 400 invalid_recovery_payload（B.8 信封，非通用 1002）", async () => {
    const repo = buildRepo({ kind: "applied", preview_id: "7001", scene_card_id: "5001", generation_job_id: "8101", cursor: "42" });
    const bad = { ...BASE_BODY, canvas_binding: { protocol_version: 2, submission_id: "not-uuid" } };

    const res = await handleStoryboardPreviewCreate(
      "42", "1", "5001", UUID, JSON.stringify(bad), repo, OPTIONS,
    );

    expect(res).toMatchObject({ code: 400, data: { reason: "invalid_recovery_payload" } });
    expect(repo.createStoryboardPreview).not.toHaveBeenCalled();
  });

  it("★ 受理冲突（repo 抛 RecoveryContractError）→ 受控信封直返，不被当 500", async () => {
    const repo = buildRepo(undefined);
    repo.createStoryboardPreview.mockRejectedValue(
      new RecoveryContractError({
        code: 409,
        msg: "目标节点承接版本已变化，请刷新后重试",
        data: { reason: "canvas_binding_conflict", currentBindingRevision: 3 },
      }),
    );

    const res = await handleStoryboardPreviewCreate(
      "42", "1", "5001", UUID, requestBody({ canvas_binding: binding(UUID) }), repo, OPTIONS,
    );

    expect(res).toEqual({
      code: 409,
      msg: "目标节点承接版本已变化，请刷新后重试",
      data: { reason: "canvas_binding_conflict", currentBindingRevision: 3 },
    });
  });

  it("★ 同意图重放（repo replayed）→ 响应与受理同形，携带原关联视图", async () => {
    const repo = buildRepo({
      kind: "replayed",
      preview_id: "7001",
      scene_card_id: "5001",
      generation_job_id: "8101",
    }, { ...BINDING_VIEW, is_current: false });

    const res = await handleStoryboardPreviewCreate(
      "42", "1", "5001", UUID, requestBody({ canvas_binding: binding(UUID) }), repo, OPTIONS,
    );

    expect(res.code).toBe(200);
    expect(res.data).toMatchObject({
      preview_id: 7001,
      generation_job_id: 8101,
      canvas_binding: { submission_id: UUID, is_current: false },
    });
  });

  it("不携带 canvas_binding → 行为不变：无 canvasRecovery、响应无 canvas_binding 字段", async () => {
    const repo = buildRepo({
      kind: "applied",
      preview_id: "7001",
      scene_card_id: "5001",
      generation_job_id: "8101",
      cursor: "42",
    });

    const res = await handleStoryboardPreviewCreate(
      "42", "1", "5001", "plain-key", requestBody(), repo, OPTIONS,
    );

    expect(res.code).toBe(200);
    expect(res.data).not.toHaveProperty("canvas_binding");
    expect(repo.createStoryboardPreview.mock.calls[0]![0].canvasRecovery).toBeUndefined();
    expect(repo.canvasBindingView).not.toHaveBeenCalled();
  });
});
