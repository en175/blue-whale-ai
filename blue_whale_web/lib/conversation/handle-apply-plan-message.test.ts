import {
  ASSET_UNAVAILABLE_CODE,
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  PLAN_APPLICATION_ALREADY_APPLIED_CODE,
  PLAN_APPLICATION_CAPABILITY_DRIFT_CODE,
  PLAN_APPLICATION_KIND_UNSUPPORTED_CODE,
  PLAN_APPLICATION_PLAN_NOT_FOUND_CODE,
  PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE,
  RESOURCE_NOT_FOUND_CODE,
} from "@blue-whale/contracts";
import type { PlanApplicationRepo } from "@blue-whale/persistence";
import { describe, expect, it, vi } from "vitest";

import {
  handleApplyPlanMessage,
  planApplicationRequestHash,
} from "./handle-apply-plan-message";

/** 图片分支成功响应形状（envelope data 为媒体联合，测试内窄化）。 */
type ImageApplyData = {
  receipt: { application_kind: string; scene_card_id: string | null };
  first_generation_job_id: string;
};

function deps(result: unknown): PlanApplicationRepo {
  return {
    applyPlanMessage: vi.fn().mockResolvedValue(result),
  } as unknown as PlanApplicationRepo;
}

const imageReceipt = {
  receipt_id: "1",
  plan_message_id: "100",
  project_id: "42",
  conversation_id: "50",
  agent_run_id: "9",
  application_kind: "image_generate" as const,
  scene_card_id: null,
  first_generation_job_id: "200",
  content_digest: `sha256:${"a".repeat(64)}`,
  applied_at: "2026-08-05T10:00:00.000Z",
};

describe("handleApplyPlanMessage（契约 §9 / IK67H9 视频分支）", () => {
  it("缺少 Idempotency-Key 返回 100000", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "5001",
      null,
      "",
      deps({}),
    );
    expect(result.code).toBe(PARAM_MISSING_CODE);
  });

  it("messageId 非十进制返回计划不存在", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "abc",
      "key-1",
      "",
      deps({}),
    );
    expect(result.code).toBe(PLAN_APPLICATION_PLAN_NOT_FOUND_CODE);
  });

  it("projectId 非十进制返回计划不存在", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "abc",
      "5001",
      "key-1",
      "",
      deps({}),
    );
    expect(result.code).toBe(PLAN_APPLICATION_PLAN_NOT_FOUND_CODE);
  });

  it("成功应用返回 scene_card_id/generation_job_id/receipt_id", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "5001",
      "key-1",
      "",
      deps({
        kind: "applied",
        scene_card_id: "5001",
        generation_job_id: "9001",
        receipt_id: "7001",
        cursor: "100",
      }),
    );
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({
      scene_card_id: 5001,
      generation_job_id: 9001,
      receipt_id: 7001,
      application_kind: "scene_card_create",
    });
  });

  it("重放返回首次结果（不包含 receipt_id/cursor）", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "5001",
      "key-1",
      "",
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
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "5001",
      "key-1",
      "",
      deps({ kind: "idempotency_conflict" }),
    );
    expect(result.code).toBe(IDEMPOTENCY_KEY_REUSED_CODE);
  });

  it("already_applied（视频）映射 100404", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "5001",
      "key-1",
      "",
      deps({ kind: "already_applied" }),
    );
    expect(result.code).toBe(PLAN_APPLICATION_ALREADY_APPLIED_CODE);
  });

  it("plan_not_found 映射 100401", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "5001",
      "key-1",
      "",
      deps({ kind: "plan_not_found" }),
    );
    expect(result.code).toBe(PLAN_APPLICATION_PLAN_NOT_FOUND_CODE);
  });

  it("forbidden（项目不归属）映射 100301，不泄漏存在性", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "5001",
      "key-1",
      "",
      deps({ kind: "forbidden" }),
    );
    expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
  });

  it("kind_unsupported 映射 100402", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "5001",
      "key-1",
      "",
      deps({ kind: "kind_unsupported" }),
    );
    expect(result.code).toBe(PLAN_APPLICATION_KIND_UNSUPPORTED_CODE);
  });

  it("capability_drift 映射 100403", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "5001",
      "key-1",
      "",
      deps({ kind: "capability_drift" }),
    );
    expect(result.code).toBe(PLAN_APPLICATION_CAPABILITY_DRIFT_CODE);
  });

  it("validation_failed 映射素材失效 100202", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "5001",
      "key-1",
      "",
      deps({ kind: "validation_failed", reason: "x" }),
    );
    expect(result.code).toBe(ASSET_UNAVAILABLE_CODE);
  });

  it("requestHash 随 body 变化（同 key 不同 body 判冲突的基础）", async () => {
    const mock = vi.fn().mockResolvedValue({ kind: "plan_not_found" });
    const repo = { applyPlanMessage: mock } as unknown as PlanApplicationRepo;
    await handleApplyPlanMessage("100", "42", "5001", "key-1", "", repo);
    await handleApplyPlanMessage("100", "42", "5001", "key-1", '{"x":1}', repo);
    const [firstHash, secondHash] = [
      mock.mock.calls[0][0].requestHash,
      mock.mock.calls[1][0].requestHash,
    ];
    expect(firstHash).not.toBe(secondHash);
    expect(firstHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("handleApplyPlanMessage（契约 §9 / IK67H8 图片分支）", () => {
  it("applied_image → ok(receipt, first_generation_job_id)", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "100",
      "key",
      "",
      deps({
        kind: "applied_image",
        receipt: imageReceipt,
        first_generation_job_id: "200",
        cursor: "500",
      }),
    );
    expect(result.code).toBe(200);
    const data = result.data as ImageApplyData;
    expect(data.first_generation_job_id).toBe("200");
    expect(data.receipt).toMatchObject({
      application_kind: "image_generate",
      scene_card_id: null,
    });
  });

  it("replayed_image → ok（同首次形状）", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "100",
      "key",
      "",
      deps({
        kind: "replayed_image",
        receipt: imageReceipt,
        first_generation_job_id: "200",
        cursor: "500",
      }),
    );
    expect(result.code).toBe(200);
    expect((result.data as ImageApplyData).first_generation_job_id).toBe("200");
  });

  it("already_applied_image → ok（at-most-once 回首次）", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "100",
      "key",
      "",
      deps({
        kind: "already_applied_image",
        receipt: imageReceipt,
        first_generation_job_id: "200",
      }),
    );
    expect(result.code).toBe(200);
    expect((result.data as ImageApplyData).first_generation_job_id).toBe("200");
  });

  it("blocked_requires_new_plan（素材失效）→ 100202", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "100",
      "key",
      "",
      deps({
        kind: "blocked_requires_new_plan",
        reason: "素材已失效",
        blockedBy: "mention_unavailable",
      }),
    );
    expect(result.code).toBe(ASSET_UNAVAILABLE_CODE);
    expect(result.msg).toBe("素材已失效");
  });

  it("blocked_requires_new_plan（能力漂移）→ 100403", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "100",
      "key",
      "",
      deps({
        kind: "blocked_requires_new_plan",
        reason: "能力已变更",
        blockedBy: "capability_drifted",
      }),
    );
    expect(result.code).toBe(PLAN_APPLICATION_CAPABILITY_DRIFT_CODE);
  });

  it("blocked_retryable → 100405 余额不足", async () => {
    const result = await handleApplyPlanMessage(
      "100",
      "42",
      "100",
      "key",
      "",
      deps({ kind: "blocked_retryable", reason: "余额不足" }),
    );
    expect(result.code).toBe(PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE);
    expect(result.msg).toBe("余额不足");
  });

  it("internal 的 providerCredential/quotaCheck 透传给 repo", async () => {
    const mock = vi.fn().mockResolvedValue({ kind: "plan_not_found" });
    const repo = { applyPlanMessage: mock } as unknown as PlanApplicationRepo;
    const quotaCheck = async () => ({ sufficient: true });
    await handleApplyPlanMessage("100", "42", "100", "key", "", repo, {
      providerCredential: "sealed",
      quotaCheck,
    });
    expect(mock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerCredential: "sealed",
        quotaCheck,
        requestHash: planApplicationRequestHash("42", "100", ""),
      }),
    );
  });
});
