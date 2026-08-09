// IK74V8：从 plan-application-repo.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import {beforeEach, describe, expect, it, vi} from "vitest";

import {TARGET_MENTION_ID, TARGET_SCENE_CARD_ID, baseInput, buildCapabilityRow, buildReplacePlanMessageRow, buildTargetMention, buildTargetSceneCard, buildTx, repoWith} from "./plan-application-repo.testlib.js";

describe("PlanApplicationRepo.applyPlanMessage（覆盖分支 / IK67HA）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("成功覆盖：UPDATE 既有卡（version+1）+ 新建 receipt/record/job，保留既有记录（AC#5）", async () => {
    const planRow = buildReplacePlanMessageRow();
    const REPLACE_RECORD_ID = 7501n;
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(planRow) },
      conversation_message_mentions: {
        findUnique: vi.fn().mockResolvedValue(buildTargetMention()),
      },
      scene_cards: { findUnique: vi.fn().mockResolvedValue(buildTargetSceneCard()) },
      scene_card_generation_records: {
        create: vi.fn().mockResolvedValue({ id: REPLACE_RECORD_ID }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.applyPlanMessage(baseInput);

    expect(result).toMatchObject({
      kind: "applied",
      application_kind: "scene_card_replace",
      scene_card_id: "6001",
      generation_job_id: "9001",
      receipt_id: "7001",
    });
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
    expect(tx.scene_cards.updateMany).toHaveBeenCalledOnce();
    const updateArg = tx.scene_cards.updateMany.mock.calls[0][0];
    expect(updateArg.where).toEqual({
      id: 6001n,
      project_id: 42n,
      version: 1,
      is_delete: 0,
    });
    expect(updateArg.data.version).toEqual({ increment: 1 });
    expect(updateArg.data.content_markdown).toBe(planRow.content_markdown);
    expect(tx.scene_card_generation_presets.create).not.toHaveBeenCalled();
    expect(tx.scene_card_generation_presets.updateMany).toHaveBeenCalledOnce();
    const presetUpdateArg = tx.scene_card_generation_presets.updateMany.mock.calls[0][0];
    expect(presetUpdateArg.where).toEqual({ scene_card_id: TARGET_SCENE_CARD_ID, is_delete: 0 });
    expect(presetUpdateArg.data.version).toEqual({ increment: 1 });
    expect(tx.scene_card_generation_records.create).toHaveBeenCalledOnce();
    // IK7GRT：与 create / regenerate 同款——record 创建后回填首个 job 的输出槽绑定该 record，
    // 使汇总同步与 Snapshot 投影对 replace 路径同样成立（堵住「少一次调用」的既有测试盲区）。
    expect(tx.generation_output_slots.updateMany).toHaveBeenCalledOnce();
    const slotBackfillArg = tx.generation_output_slots.updateMany.mock.calls[0][0];
    expect(slotBackfillArg.where).toEqual({ generation_job_id: 9001n });
    expect(slotBackfillArg.data).toEqual({
      scene_card_generation_record_id: REPLACE_RECORD_ID,
    });
    const receiptArg = tx.plan_application_receipts.create.mock.calls[0][0].data;
    expect(receiptArg.application_kind).toBe("scene_card_replace");
    expect(receiptArg.result_version).toBe(2);
    expect(receiptArg.target_scene_card_mention_id).toBe(TARGET_MENTION_ID);
    expect(receiptArg.scene_card_id).toBe(TARGET_SCENE_CARD_ID);
    expect(tx.command_idempotency.create.mock.calls[0][0].data.resource_id).toBe(
      TARGET_SCENE_CARD_ID,
    );
  });

  it("重复 CommandId 命中则重放首次结果（application_kind=scene_card_replace），不再覆盖（AC#6）", async () => {
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(buildReplacePlanMessageRow()) },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue({
          request_hash: baseInput.requestHash,
          resource_id: TARGET_SCENE_CARD_ID,
          generation_job_id: 9001n,
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.applyPlanMessage(baseInput);

    expect(result).toEqual({
      kind: "replayed",
      application_kind: "scene_card_replace",
      scene_card_id: "6001",
      generation_job_id: "9001",
    });
    expect(tx.scene_cards.updateMany).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
  });

  it("plan_message 不存在返回 plan_not_found", async () => {
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
          buildReplacePlanMessageRow({ application_kind: "unknown_kind" }),
        ),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("kind_unsupported");
  });

  it("同消息已被成功应用返回 already_applied，零写入", async () => {
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(buildReplacePlanMessageRow()) },
      plan_application_receipts: {
        findUnique: vi.fn().mockResolvedValue({ id: 7001n }),
        create: vi.fn(),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("already_applied");
    expect(tx.scene_cards.updateMany).not.toHaveBeenCalled();
  });

  it("能力漂移零写入（AC#4）", async () => {
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(buildReplacePlanMessageRow()) },
      generation_model_capability: {
        findUnique: vi.fn().mockResolvedValue(buildCapabilityRow(99)),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("capability_drift");
    expect(tx.scene_cards.updateMany).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
  });

  it("target mention 缺失返回 target_stale，零写入（AC#4）", async () => {
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(buildReplacePlanMessageRow()) },
      conversation_message_mentions: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("target_stale");
    expect(tx.scene_cards.updateMany).not.toHaveBeenCalled();
  });

  it("target mention 跨项目返回 target_stale，零写入（AC#4）", async () => {
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(buildReplacePlanMessageRow()) },
      conversation_message_mentions: {
        findUnique: vi.fn().mockResolvedValue(buildTargetMention({ project_id: 999n })),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("target_stale");
    expect(tx.scene_cards.updateMany).not.toHaveBeenCalled();
  });

  it("target 场景卡软删返回 target_stale，零写入（AC#4）", async () => {
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(buildReplacePlanMessageRow()) },
      conversation_message_mentions: {
        findUnique: vi.fn().mockResolvedValue(buildTargetMention()),
      },
      scene_cards: {
        findUnique: vi.fn().mockResolvedValue(buildTargetSceneCard({ is_delete: 1 })),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("target_stale");
    expect(tx.scene_cards.updateMany).not.toHaveBeenCalled();
  });

  it("target 场景卡版本不符（stale）返回 target_stale，零写入（AC#4）", async () => {
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(buildReplacePlanMessageRow()) },
      conversation_message_mentions: {
        findUnique: vi.fn().mockResolvedValue(buildTargetMention()),
      },
      scene_cards: {
        findUnique: vi.fn().mockResolvedValue(buildTargetSceneCard({ version: 2 })),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("target_stale");
    expect(tx.scene_cards.updateMany).not.toHaveBeenCalled();
  });

  it("mention.target_version 与 base_scene_card_version 发散返回 target_stale（AC#4 精确分类）", async () => {
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(buildReplacePlanMessageRow()) },
      conversation_message_mentions: {
        findUnique: vi.fn().mockResolvedValue(buildTargetMention({ target_version: 2 })),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("target_stale");
    expect(tx.scene_cards.updateMany).not.toHaveBeenCalled();
  });

  it("target mention 越权（accepted_user_id 非当前用户）返回 target_stale，零写入（AC#4）", async () => {
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(buildReplacePlanMessageRow()) },
      conversation_message_mentions: {
        findUnique: vi.fn().mockResolvedValue(
          buildTargetMention({ accepted_user_id: 999n }),
        ),
      },
      scene_cards: { findUnique: vi.fn().mockResolvedValue(buildTargetSceneCard()) },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("target_stale");
    expect(tx.scene_cards.updateMany).not.toHaveBeenCalled();
  });

  it("乐观锁竞争（UPDATE 命中 0 行）返回 target_stale，零写入（AC#4）", async () => {
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(buildReplacePlanMessageRow()) },
      conversation_message_mentions: {
        findUnique: vi.fn().mockResolvedValue(buildTargetMention()),
      },
      scene_cards: {
        findUnique: vi.fn().mockResolvedValue(buildTargetSceneCard()),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("target_stale");
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
    expect(tx.scene_card_generation_records.create).not.toHaveBeenCalled();
    expect(tx.command_idempotency.create).not.toHaveBeenCalled();
  });

  it("preset 不存在时 UPDATE 命中 0 行回退 INSERT（防御 upsert，AC#5）", async () => {
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(buildReplacePlanMessageRow()) },
      conversation_message_mentions: {
        findUnique: vi.fn().mockResolvedValue(buildTargetMention()),
      },
      scene_cards: { findUnique: vi.fn().mockResolvedValue(buildTargetSceneCard()) },
      scene_card_generation_presets: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({}),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.applyPlanMessage(baseInput);

    expect(result.kind).toBe("applied");
    expect(tx.scene_card_generation_presets.updateMany).toHaveBeenCalledOnce();
    expect(tx.scene_card_generation_presets.create).toHaveBeenCalledOnce();
  });
});
