import {
  ASSET_UNAVAILABLE_CODE,
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  PLAN_APPLICATION_ALREADY_APPLIED_CODE,
  PLAN_APPLICATION_CAPABILITY_DRIFT_CODE,
  PLAN_APPLICATION_KIND_UNSUPPORTED_CODE,
  PLAN_APPLICATION_PLAN_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_CODE,
} from "@blue-whale/contracts";
import type { PlanApplicationRepo } from "@blue-whale/persistence";
import { describe, expect, it, vi } from "vitest";

import { handleApplyPlanMessage } from "./handle-apply-plan-message";

function deps(result: unknown): PlanApplicationRepo {
  return {
    applySceneCardCreatePlan: vi.fn().mockResolvedValue(result),
  } as unknown as PlanApplicationRepo;
}

describe("handleApplyPlanMessage（契约 §9 / IK67H9）", () => {
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

  it("already_applied 映射 100404", async () => {
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
    const repo = {
      applySceneCardCreatePlan: mock,
    } as unknown as PlanApplicationRepo;
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
