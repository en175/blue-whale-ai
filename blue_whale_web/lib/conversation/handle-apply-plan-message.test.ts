import {
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  PLAN_APPLY_CONFLICT_CODE,
  QUOTA_INSUFFICIENT_CODE,
  RESOURCE_NOT_FOUND_CODE,
} from "@blue-whale/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  handleApplyPlanMessage,
  planApplyRequestHash,
} from "./handle-apply-plan-message";

const receipt = {
  receipt_id: "1",
  plan_message_id: "100",
  project_id: "1",
  conversation_id: "50",
  agent_run_id: "9",
  application_kind: "image_generate" as const,
  scene_card_id: null,
  first_generation_job_id: "200",
  content_digest: `sha256:${"a".repeat(64)}`,
  applied_at: "2026-08-05T10:00:00.000Z",
};

function makeDeps() {
  return {
    applyPlanMessage: vi.fn(),
    quotaCheck: vi.fn().mockResolvedValue({ sufficient: true }),
  };
}

const internal = { providerCredential: "sealed" };

describe("planApplyRequestHash", () => {
  it("是 method+operation+path 的 SHA-256 摘要", () => {
    expect(planApplyRequestHash("1", "100")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("handleApplyPlanMessage", () => {
  it("缺 Idempotency-Key → PARAM_MISSING，不触达 repo", async () => {
    const deps = makeDeps();
    const result = await handleApplyPlanMessage(
      "1",
      "1",
      "100",
      null,
      deps,
      internal,
    );
    expect(result.code).toBe(PARAM_MISSING_CODE);
    expect(deps.applyPlanMessage).not.toHaveBeenCalled();
  });

  it("非数字 messageId → RESOURCE_NOT_FOUND", async () => {
    const deps = makeDeps();
    const result = await handleApplyPlanMessage(
      "1",
      "1",
      "abc",
      "key",
      deps,
      internal,
    );
    expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
    expect(deps.applyPlanMessage).not.toHaveBeenCalled();
  });

  it("非数字 projectId → RESOURCE_NOT_FOUND", async () => {
    const deps = makeDeps();
    const result = await handleApplyPlanMessage(
      "1",
      "abc",
      "100",
      "key",
      deps,
      internal,
    );
    expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
    expect(deps.applyPlanMessage).not.toHaveBeenCalled();
  });

  it("缺生成凭证 → PARAM_MISSING", async () => {
    const deps = makeDeps();
    const result = await handleApplyPlanMessage(
      "1",
      "1",
      "100",
      "key",
      deps,
      {},
    );
    expect(result.code).toBe(PARAM_MISSING_CODE);
    expect(deps.applyPlanMessage).not.toHaveBeenCalled();
  });

  it("applied → ok(receipt, job, cursor)", async () => {
    const deps = makeDeps();
    deps.applyPlanMessage.mockResolvedValue({
      kind: "applied",
      receipt,
      firstGenerationJobId: "200",
      cursor: 500,
    });
    const result = await handleApplyPlanMessage(
      "1",
      "1",
      "100",
      "key",
      deps,
      internal,
    );
    expect(result.code).toBe(200);
    expect(result.data?.first_generation_job_id).toBe("200");
    expect(deps.applyPlanMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "key",
        providerCredential: "sealed",
        requestHash: planApplyRequestHash("1", "100"),
      }),
    );
  });

  it("replayed → ok（含 job）", async () => {
    const deps = makeDeps();
    deps.applyPlanMessage.mockResolvedValue({
      kind: "replayed",
      receipt,
      firstGenerationJobId: "200",
      cursor: 500,
    });
    const result = await handleApplyPlanMessage(
      "1",
      "1",
      "100",
      "key",
      deps,
      internal,
    );
    expect(result.code).toBe(200);
    expect(result.data?.first_generation_job_id).toBe("200");
  });

  it("already_applied → ok（at-most-once 回首次）", async () => {
    const deps = makeDeps();
    deps.applyPlanMessage.mockResolvedValue({
      kind: "already_applied",
      receipt,
      firstGenerationJobId: "200",
    });
    const result = await handleApplyPlanMessage(
      "1",
      "1",
      "100",
      "key",
      deps,
      internal,
    );
    expect(result.code).toBe(200);
    expect(result.data?.first_generation_job_id).toBe("200");
  });

  it("not_found → RESOURCE_NOT_FOUND", async () => {
    const deps = makeDeps();
    deps.applyPlanMessage.mockResolvedValue({ kind: "not_found" });
    const result = await handleApplyPlanMessage(
      "1",
      "1",
      "100",
      "key",
      deps,
      internal,
    );
    expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
  });

  it("idempotency_conflict → IDEMPOTENCY_KEY_REUSED", async () => {
    const deps = makeDeps();
    deps.applyPlanMessage.mockResolvedValue({ kind: "idempotency_conflict" });
    const result = await handleApplyPlanMessage(
      "1",
      "1",
      "100",
      "key",
      deps,
      internal,
    );
    expect(result.code).toBe(IDEMPOTENCY_KEY_REUSED_CODE);
  });

  it("blocked_requires_new_plan → PLAN_APPLY_CONFLICT(409)", async () => {
    const deps = makeDeps();
    deps.applyPlanMessage.mockResolvedValue({
      kind: "blocked_requires_new_plan",
      reason: "素材已失效",
    });
    const result = await handleApplyPlanMessage(
      "1",
      "1",
      "100",
      "key",
      deps,
      internal,
    );
    expect(result.code).toBe(PLAN_APPLY_CONFLICT_CODE);
    expect(result.msg).toBe("素材已失效");
  });

  it("blocked_retryable → QUOTA_INSUFFICIENT(402)", async () => {
    const deps = makeDeps();
    deps.applyPlanMessage.mockResolvedValue({
      kind: "blocked_retryable",
      reason: "余额不足",
    });
    const result = await handleApplyPlanMessage(
      "1",
      "1",
      "100",
      "key",
      deps,
      internal,
    );
    expect(result.code).toBe(QUOTA_INSUFFICIENT_CODE);
    expect(result.msg).toBe("余额不足");
  });
});
