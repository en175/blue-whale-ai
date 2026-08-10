// IK74V8：从 plan-application-repo.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import {beforeEach, describe, expect, it, vi} from "vitest";

import {baseInput, buildCapabilityRow, buildPlanMessageRow, buildTx, repoWith} from "./plan-application-repo.testlib.js";

describe("PlanApplicationRepo.applyPlanMessage（视频分支 / IK67H9）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("成功事务原子创建五条产品事实（AC#2/#3）", async () => {
    const tx = buildTx({});
    const { repo } = repoWith(tx);

    const result = await repo.applyPlanMessage(baseInput);

    expect(result).toMatchObject({
      kind: "applied",
      scene_card_id: "5001",
      generation_job_id: "9001",
      receipt_id: "7001",
    });
    expect(tx.scene_cards.create).toHaveBeenCalledOnce();
    expect(tx.scene_card_generation_presets.create).toHaveBeenCalledOnce();
    expect(tx.scene_card_generation_records.create).toHaveBeenCalledOnce();
    expect(tx.plan_application_receipts.create).toHaveBeenCalledOnce();
    expect(tx.generation_jobs.create).toHaveBeenCalledOnce();
    expect(tx.generation_jobs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expected_output_count: 1,
        input: expect.objectContaining({
          provider_credential: "sealed-provider-token",
        }),
      }),
    });
    expect(tx.generation_output_slots.create).toHaveBeenCalledOnce();
    expect(tx.command_idempotency.create).toHaveBeenCalledOnce();
    // 回执落盘带 scene_card_id + job_id + command_id。
    const receiptArg =
      tx.plan_application_receipts.create.mock.calls[0][0].data;
    expect(receiptArg.scene_card_id).toBe(5001n);
    expect(receiptArg.command_id).toBe("cmd-1");
    expect(receiptArg.application_kind).toBe("scene_card_create");
  });

  it("重复 CommandId 命中则重放首次结果，不再创建（AC#6）", async () => {
    const tx = buildTx({
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue({
          request_hash: baseInput.requestHash,
          resource_id: 5001n,
          generation_job_id: 9001n,
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.applyPlanMessage(baseInput);

    expect(result).toEqual({
      kind: "replayed",
      application_kind: "scene_card_create",
      scene_card_id: "5001",
      generation_job_id: "9001",
    });
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
  });

  it("同 CommandId 不同内容拒绝（AC#6 idempotency_conflict）", async () => {
    const tx = buildTx({
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue({
          request_hash: "b".repeat(64),
          resource_id: 5001n,
          generation_job_id: 9001n,
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("idempotency_conflict");
  });

  it("plan_message 不存在或跨项目返回 plan_not_found", async () => {
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("plan_not_found");
  });

  it("未知 application_kind 返回 kind_unsupported（dispatcher 兜底）", async () => {
    const tx = buildTx({
      plan_messages: {
        findUnique: vi.fn().mockResolvedValue(
          buildPlanMessageRow({ application_kind: "unknown_kind" }),
        ),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("kind_unsupported");
  });

  it("同消息已被成功应用（不同 CommandId）返回 already_applied（CONTEXT L227）", async () => {
    const tx = buildTx({
      plan_application_receipts: {
        findUnique: vi.fn().mockResolvedValue({ id: 7001n }),
        create: vi.fn(),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("already_applied");
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
  });

  it("能力漂移（行版本变化）零写入（AC#4）", async () => {
    const tx = buildTx({
      generation_model_capability: {
        findUnique: vi.fn().mockResolvedValue(buildCapabilityRow(99)),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.applyPlanMessage(baseInput);

    expect(result.kind).toBe("capability_drift");
    // 原子性：五条事实一条都不写。
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
    expect(tx.scene_card_generation_presets.create).not.toHaveBeenCalled();
    expect(tx.scene_card_generation_records.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
    expect(tx.command_idempotency.create).not.toHaveBeenCalled();
  });

  it("能力被禁用视为漂移零写入", async () => {
    const tx = buildTx({
      generation_model_capability: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ ...buildCapabilityRow(), enabled: false }),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("capability_drift");
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
  });

  it("项目不归属当前用户返回 forbidden（AC#4 授权）", async () => {
    const tx = buildTx({
      project: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("forbidden");
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
  });

  it("引用素材失效返回 validation_failed 且零写入（AC#4）", async () => {
    const planRow = buildPlanMessageRow({
      derived_references: [
        {
          mention_id: "101",
          mention_seq: 0,
          type: "asset",
          first_seen_offset: 9,
        },
      ],
    });
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(planRow) },
      conversation_message_mentions: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 101n, target_id: 201n, project_id: 42n }]),
      },
      assets: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 201n, project_id: 42n, status: "deleted", is_delete: false },
          ]),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.applyPlanMessage(baseInput);

    expect(result.kind).toBe("validation_failed");
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
  });
});

// —— 图片分支（IK67H8/T10）：媒体感知分派 + 双层幂等 + 预检零写入 ——
