// IK74V8：从 plan-application-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 场景卡应用主路径：create 与 replace 两条事务内实现。
import type { Prisma } from "@prisma/client";

import { appendProjectEvent } from "./product-event-repo.js";
import { classifyMentionAvailability } from "./mention-availability.js";
import {
  OPERATION,
  sceneCardTitle,
  sha256Digest,
} from "./plan-application-internals.js";
import {
  createPlanVideoJobWithinTx,
  presetDigestFromFrozen,
  runSceneCardApplyPreflight,
} from "./plan-application-scene-card-preflight.js";
import type {
  SceneCardApplyPlanMessage,
} from "./plan-application-scene-card-preflight.js";
import type {
  ApplyPlanMessageInput,
  ApplyPlanMessageResult,
} from "./plan-application-types.js";

export async function applySceneCardCreateInTransaction(
  tx: Prisma.TransactionClient,
  input: ApplyPlanMessageInput,
  planMessage: SceneCardApplyPlanMessage,
): Promise<ApplyPlanMessageResult> {
  const projectId = BigInt(input.projectId);

  // 前置校验（CommandId 幂等 / 防重复 / 能力漂移 / 引用有效性）收敛到共享流水线；
  // 任一失败原样透传，全过则返回解析出的快照/冻结参数/投影。
  const preflight = await runSceneCardApplyPreflight(
    tx,
    projectId,
    input,
    planMessage,
    "scene_card_create",
  );
  if (preflight.kind === "early_return") return preflight.result;
  const { snapshot, frozenParameters, projection } = preflight.resolved;

  // === 前置检查全部通过，开始原子创建五条产品事实（AC#2/#3）===

  // 5. INSERT scene_cards（version=1，权威正文来自 plan_message.content_markdown）。
  const sceneCard = await tx.scene_cards.create({
    data: {
      project_id: projectId,
      title: sceneCardTitle(
        planMessage.sequence_label,
        planMessage.content_markdown,
      ),
      summary: null,
      content_markdown: planMessage.content_markdown,
      version: 1,
    },
  });
  const sceneCardId = sceneCard.id;

  // 6. 创建首个视频 GenerationJob（source=plan），复用 createJobWithinTx 组合进本事务。
  const { generationJobId, cursor: jobCursor, referenceMode } =
    await createPlanVideoJobWithinTx(
      tx,
      input,
      planMessage,
      preflight.resolved,
      sceneCardId,
      "scene_card_create",
    );
  let cursor = jobCursor;

  // 7. INSERT plan_application_receipts（不可变事实，带 scene_card_id + job_id + command_id）。
  const presetDigest = presetDigestFromFrozen(
    frozenParameters,
    referenceMode,
    projection.reference_assets,
    snapshot,
  );
  const contentDigest = sha256Digest(planMessage.content_markdown);
  const appliedAt = new Date();
  const receipt = await tx.plan_application_receipts.create({
    data: {
      message_id: planMessage.message_id,
      project_id: projectId,
      application_kind: "scene_card_create",
      scene_card_id: sceneCardId,
      first_generation_job_id: BigInt(generationJobId),
      command_id: input.idempotencyKey,
      content_digest: contentDigest,
      result_version: 1,
      preset_digest: presetDigest,
      target_scene_card_mention_id: null,
      applied_at: appliedAt,
    },
  });

  // 8. INSERT scene_card_generation_presets（1:1，从冻结参数 + 投影创建）。
  await tx.scene_card_generation_presets.create({
    data: {
      scene_card_id: sceneCardId,
      project_id: projectId,
      parameters: frozenParameters as unknown as Prisma.InputJsonValue,
      reference_mode: referenceMode,
      reference_assets:
        projection.reference_assets as unknown as Prisma.InputJsonValue,
      capability_snapshot_version: snapshot as unknown as Prisma.InputJsonValue,
    },
  });

  // 9. INSERT scene_card_generation_records（首次 summary_status=generating）。
  const record = await tx.scene_card_generation_records.create({
    data: {
      scene_card_id: sceneCardId,
      project_id: projectId,
      summary_status: "generating",
      plan_message_id: planMessage.message_id,
      application_receipt_id: receipt.id,
      first_generation_job_id: BigInt(generationJobId),
    },
  });
  // IK67HE/T14：回填首个 job 的输出槽绑定 record（createJobWithinTx 早于 record 创建），
  // 使 publishVideoResult 能经槽位找到 scene_card_id 做视频节点放置 + record 聚合。
  await tx.generation_output_slots.updateMany({
    where: { generation_job_id: BigInt(generationJobId) },
    data: { scene_card_generation_record_id: record.id },
  });

  // 10. INSERT command_idempotency（resource_id=scene_card_id，generation_job_id）。
  await tx.command_idempotency.create({
    data: {
      project_id: projectId,
      operation: OPERATION,
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
      generation_job_id: BigInt(generationJobId),
      resource_id: sceneCardId,
      accepted_cursor: BigInt(cursor),
    },
  });

  // 11. project_events：scene_card.created + plan_application.succeeded。
  const sceneCardEvent = await appendProjectEvent(tx, {
    projectId: input.projectId,
    eventType: "scene_card.created",
    aggregateType: "scene_card",
    aggregateId: sceneCardId.toString(),
    aggregateVersion: 1,
    correlationId: input.idempotencyKey,
    payload: {
      scene_card_id: sceneCardId.toString(),
      plan_message_id: planMessage.message_id.toString(),
      generation_job_id: generationJobId,
    },
  });
  const applyEvent = await appendProjectEvent(tx, {
    projectId: input.projectId,
    eventType: "plan_application.succeeded",
    aggregateType: "plan_application_receipt",
    aggregateId: receipt.id.toString(),
    aggregateVersion: 1,
    correlationId: input.idempotencyKey,
    payload: {
      receipt_id: receipt.id.toString(),
      message_id: planMessage.message_id.toString(),
      scene_card_id: sceneCardId.toString(),
      generation_job_id: generationJobId,
      application_kind: "scene_card_create",
    },
  });
  cursor = Math.max(
    cursor,
    Number(applyEvent.cursor),
    Number(sceneCardEvent.cursor),
  );

  return {
    kind: "applied",
    application_kind: "scene_card_create",
    scene_card_id: sceneCardId.toString(),
    generation_job_id: generationJobId,
    receipt_id: receipt.id.toString(),
    cursor: cursor.toString(),
  };
}

/** 单事务原子应用 scene_card_replace PlanMessage（AC#4/#5/#6，IK67HA/T12）。
 *  覆盖本轮唯一可用的 SceneCardMention 指向的场景卡：重校验目标身份/版本/权限后，
 *  以乐观锁 CAS 覆盖权威正文与预设，新建生成记录与首个任务，保留既有记录/Asset/审计。
 *  任一前置检查失败零写入；同 CommandId 重复返回首次结果。
 *  forbidden/读 plan_message 已由 dispatcher 完成；本函数从共享前置校验起（与 create 同源）。 */
export async function applySceneCardReplaceInTransaction(
  tx: Prisma.TransactionClient,
  input: ApplyPlanMessageInput,
  planMessage: SceneCardApplyPlanMessage,
): Promise<ApplyPlanMessageResult> {
  const projectId = BigInt(input.projectId);
  const userId = BigInt(input.userId);

  // 前置校验（CommandId 幂等 / 防重复 / 能力漂移 / 引用有效性）收敛到共享流水线（与 create 同源）。
  const preflight = await runSceneCardApplyPreflight(
    tx,
    projectId,
    input,
    planMessage,
    "scene_card_replace",
  );
  if (preflight.kind === "early_return") return preflight.result;
  const { snapshot, frozenParameters, projection } = preflight.resolved;

  // 5. target 重校验（AC#4 核心）：从 plan_message 冻结的 mention 句柄反查当前事实，
  //    用 classifyMentionAvailability 分类 deleted/wrong_project/permission_lost/stale。
  const targetMentionId = planMessage.target_scene_card_mention_id;
  const baseVersion = planMessage.base_scene_card_version;
  if (targetMentionId === null || baseVersion === null)
    return { kind: "target_stale", reason: "missing target mention or base version" };

  const mention = await tx.conversation_message_mentions.findUnique({
    where: { id: targetMentionId },
    select: {
      id: true,
      target_id: true,
      target_version: true,
      accepted_user_id: true,
      project_id: true,
      mention_type: true,
    },
  });
  if (
    !mention ||
    mention.project_id !== projectId ||
    mention.mention_type !== "scene_card"
  )
    return { kind: "target_stale", reason: "target mention unavailable" };

  // base_scene_card_version 与 mention.target_version 在冻结时同源（RunCommit 从 mention 反查 base）；
  // 发散属数据不一致，按 target_stale 精确返回，而非依赖后续 CAS 兜底为笼统 reason。
  if (mention.target_version !== baseVersion)
    return { kind: "target_stale", reason: "target version diverged from base" };

  const targetSceneCard = await tx.scene_cards.findUnique({
    where: { id: mention.target_id },
    select: { id: true, project_id: true, version: true, is_delete: true },
  });
  const { availability, reason } = classifyMentionAvailability({
    type: "scene_card",
    targetVersion: mention.target_version,
    acceptedUserId: mention.accepted_user_id,
    sceneCard:
      targetSceneCard === null
        ? undefined
        : {
            project_id: targetSceneCard.project_id,
            version: targetSceneCard.version,
            is_delete: targetSceneCard.is_delete,
          },
    projectId,
    userId,
  });
  if (availability !== "available") return { kind: "target_stale", reason };

  const sceneCardId = mention.target_id;
  const newVersion = baseVersion + 1;

  // === 前置检查全部通过，开始原子覆盖（AC#5）===

  // 6. UPDATE scene_cards（乐观锁 CAS WHERE version=base）：单条带条件 UPDATE 由 InnoDB 行锁保证原子，
  //    count!==1 一次性兜底「版本被改 / 行被软删 / 行丢失」三种竞争（AC#4 要求重新引用）。
  const updateResult = await tx.scene_cards.updateMany({
    where: { id: sceneCardId, project_id: projectId, version: baseVersion, is_delete: 0 },
    data: {
      version: { increment: 1 },
      content_markdown: planMessage.content_markdown,
      title: sceneCardTitle(planMessage.sequence_label, planMessage.content_markdown),
      gmt_modified: new Date(),
    },
  });
  if (updateResult.count !== 1)
    return { kind: "target_stale", reason: "scene_card version changed or removed" };

  // 7. 创建首个视频 GenerationJob（source=plan，scene_card_id 指向既有卡）。
  const { generationJobId, cursor: jobCursor, referenceMode } =
    await createPlanVideoJobWithinTx(
      tx,
      input,
      planMessage,
      preflight.resolved,
      sceneCardId,
      "scene_card_replace",
    );
  let cursor = jobCursor;

  // 8. INSERT plan_application_receipts（kind=replace，result_version=新版本，target 非空）。
  const presetDigest = presetDigestFromFrozen(
    frozenParameters,
    referenceMode,
    projection.reference_assets,
    snapshot,
  );
  const contentDigest = sha256Digest(planMessage.content_markdown);
  const appliedAt = new Date();
  const receipt = await tx.plan_application_receipts.create({
    data: {
      message_id: planMessage.message_id,
      project_id: projectId,
      application_kind: "scene_card_replace",
      scene_card_id: sceneCardId,
      first_generation_job_id: BigInt(generationJobId),
      command_id: input.idempotencyKey,
      content_digest: contentDigest,
      result_version: newVersion,
      preset_digest: presetDigest,
      target_scene_card_mention_id: targetMentionId,
      applied_at: appliedAt,
    },
  });

  // 9. UPDATE scene_card_generation_presets（1:1，按 scene_card_id 覆盖；count===0 回退 INSERT 防御 upsert）。
  //    version+1 与编辑器再生成路径的 CAS 对齐：覆盖后在途编辑保存将命中版本冲突而非静默盖写。
  const presetUpdate = await tx.scene_card_generation_presets.updateMany({
    where: { scene_card_id: sceneCardId, is_delete: 0 },
    data: {
      parameters: frozenParameters as unknown as Prisma.InputJsonValue,
      reference_mode: referenceMode,
      reference_assets: projection.reference_assets as unknown as Prisma.InputJsonValue,
      capability_snapshot_version: snapshot as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
  if (presetUpdate.count === 0) {
    await tx.scene_card_generation_presets.create({
      data: {
        scene_card_id: sceneCardId,
        project_id: projectId,
        parameters: frozenParameters as unknown as Prisma.InputJsonValue,
        reference_mode: referenceMode,
        reference_assets: projection.reference_assets as unknown as Prisma.InputJsonValue,
        capability_snapshot_version: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // 10. INSERT scene_card_generation_records（新聚合行 generating，保留既有记录）。
  await tx.scene_card_generation_records.create({
    data: {
      scene_card_id: sceneCardId,
      project_id: projectId,
      summary_status: "generating",
      plan_message_id: planMessage.message_id,
      application_receipt_id: receipt.id,
      first_generation_job_id: BigInt(generationJobId),
    },
  });

  // 11. INSERT command_idempotency（resource_id=既有 scene_card_id，重复 CommandId 不重复覆盖/生成/计费）。
  await tx.command_idempotency.create({
    data: {
      project_id: projectId,
      operation: OPERATION,
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
      generation_job_id: BigInt(generationJobId),
      resource_id: sceneCardId,
      accepted_cursor: BigInt(cursor),
    },
  });

  // 12. project_events：scene_card.replaced（aggregateVersion=新版本）+ plan_application.succeeded（kind=replace）。
  const sceneCardEvent = await appendProjectEvent(tx, {
    projectId: input.projectId,
    eventType: "scene_card.replaced",
    aggregateType: "scene_card",
    aggregateId: sceneCardId.toString(),
    aggregateVersion: newVersion,
    correlationId: input.idempotencyKey,
    payload: {
      scene_card_id: sceneCardId.toString(),
      plan_message_id: planMessage.message_id.toString(),
      generation_job_id: generationJobId,
      base_version: baseVersion,
    },
  });
  const applyEvent = await appendProjectEvent(tx, {
    projectId: input.projectId,
    eventType: "plan_application.succeeded",
    aggregateType: "plan_application_receipt",
    aggregateId: receipt.id.toString(),
    aggregateVersion: 1,
    correlationId: input.idempotencyKey,
    payload: {
      receipt_id: receipt.id.toString(),
      message_id: planMessage.message_id.toString(),
      scene_card_id: sceneCardId.toString(),
      generation_job_id: generationJobId,
      application_kind: "scene_card_replace",
    },
  });
  cursor = Math.max(cursor, Number(applyEvent.cursor), Number(sceneCardEvent.cursor));

  return {
    kind: "applied",
    application_kind: "scene_card_replace",
    scene_card_id: sceneCardId.toString(),
    generation_job_id: generationJobId,
    receipt_id: receipt.id.toString(),
    cursor: cursor.toString(),
  };
}

/** DB receipt 行 → 契约 PlanApplyImageReceipt（图片分支：scene_card_id 恒 null）。 */
