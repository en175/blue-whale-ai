// IK74V8：从 plan-application-repo.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import {describe, expect, it, vi} from "vitest";

import {baseImageCapability, baseImageInput, baseImagePlanMessage, baseImageReceipt, makeImageTx, repoWith} from "./plan-application-repo.testlib.js";

describe("PlanApplicationRepo.applyPlanMessage（图片分支 / IK67H8）", () => {
  it("成功应用：建 job + receipt + 标记 plan_message + 幂等行 + 事件", async () => {
    const tx = makeImageTx();
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseImageInput);
    expect(result.kind).toBe("applied_image");
    if (result.kind !== "applied_image")
      throw new Error("expected applied_image");
    expect(result.first_generation_job_id).toBe("200");
    expect(result.receipt.application_kind).toBe("image_generate");
    expect(result.receipt.scene_card_id).toBeNull();
    expect(tx.generation_jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "plan_apply",
          agent_run_id: 9n,
        }),
      }),
    );
    expect(tx.plan_application_receipts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          message_id: 100n,
          command_id: "key-1",
          conversation_id: 50n,
          agent_run_id: 9n,
          scene_card_id: null,
        }),
      }),
    );
    expect(tx.plan_messages.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { message_id: 100n },
        data: expect.objectContaining({
          first_generation_job_id: 200n,
        }),
      }),
    );
    expect(tx.command_idempotency.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          operation: "plan_message.apply",
          message_id: 100n,
        }),
      }),
    );
    expect(tx.project_events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event_type: "plan_message.applied" }),
      }),
    );
  });

  it("at-most-once：已应用 → already_applied_image，换键仍回首次、不重建 job", async () => {
    const tx = makeImageTx({
      planMessage: baseImagePlanMessage({
        applied_at: new Date("2026-08-05T10:00:00.000Z"),
        first_generation_job_id: 200n,
      }),
      existingReceipt: baseImageReceipt(),
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage({
      ...baseImageInput,
      idempotencyKey: "key-2",
    });
    expect(result.kind).toBe("already_applied_image");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
  });

  it("同键同内容 → replayed_image（回首次 cursor）", async () => {
    const tx = makeImageTx({
      idem: { request_hash: "hash-1", accepted_cursor: 500n },
      existingReceipt: baseImageReceipt(),
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseImageInput);
    expect(result.kind).toBe("replayed_image");
    if (result.kind !== "replayed_image")
      throw new Error("expected replayed_image");
    expect(result.cursor).toBe("500");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("同键异内容 → idempotency_conflict", async () => {
    const tx = makeImageTx({
      idem: { request_hash: "different-hash", accepted_cursor: 500n },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseImageInput);
    expect(result.kind).toBe("idempotency_conflict");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("素材失效 → blocked_requires_new_plan(mention_unavailable)，零写入", async () => {
    const tx = makeImageTx({
      planMessage: baseImagePlanMessage({
        derived_references: [
          {
            mention_id: "999",
            mention_seq: 0,
            type: "asset",
            first_seen_offset: 0,
          },
        ],
      }),
      mentions: [
        {
          id: 999n,
          target_id: 888n,
          mention_type: "asset",
          target_version: null,
          accepted_user_id: 100n,
        },
      ],
      assets: [], // target 888 不存在 → deleted → unavailable
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseImageInput);
    expect(result.kind).toBe("blocked_requires_new_plan");
    if (result.kind !== "blocked_requires_new_plan")
      throw new Error("expected blocked");
    expect(result.blockedBy).toBe("mention_unavailable");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
    expect(tx.command_idempotency.create).not.toHaveBeenCalled();
  });

  it("余额耗尽 → blocked_retryable，零写入", async () => {
    const tx = makeImageTx();
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage({
      ...baseImageInput,
      quotaCheck: vi.fn().mockResolvedValue({ sufficient: false }),
    });
    expect(result.kind).toBe("blocked_retryable");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
    expect(tx.command_idempotency.create).not.toHaveBeenCalled();
  });

  it("能力漂移（row_version 变） → blocked_requires_new_plan(capability_drifted)", async () => {
    const tx = makeImageTx({
      capability: { ...baseImageCapability(), version: 99 },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseImageInput);
    expect(result.kind).toBe("blocked_requires_new_plan");
    if (result.kind !== "blocked_requires_new_plan")
      throw new Error("expected blocked");
    expect(result.blockedBy).toBe("capability_drifted");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("能力下线（不存在/禁用） → blocked_requires_new_plan", async () => {
    const tx = makeImageTx({ capability: null });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseImageInput);
    expect(result.kind).toBe("blocked_requires_new_plan");
  });

  it("项目不归属 → forbidden", async () => {
    const tx = makeImageTx({ project: null });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseImageInput);
    expect(result.kind).toBe("forbidden");
  });

  it("图片应用缺凭证 → validation_failed", async () => {
    const tx = makeImageTx();
    const { repo } = repoWith(tx);
    const { providerCredential, quotaCheck, ...rest } = baseImageInput;
    const result = await repo.applyPlanMessage(rest);
    expect(result.kind).toBe("validation_failed");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });
});
