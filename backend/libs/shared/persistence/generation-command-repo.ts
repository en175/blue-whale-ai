import { NewApiError } from "@lib/core";
import { promptPlanSnapshotSchema } from "@lib/contracts";
import type { Prisma, PrismaClient } from "@prisma/client";

import { transactionWithUniqueRetry } from "./conversation-repo.js";
import { assertPureJobInput } from "./job-input-purity.js";
import { withBillingCompensation, type JobBilling } from "./job-billing.js";
import { freezePlacementAnchor } from "./generation-job-placement-anchor.js";
import {
  readCreateIdempotency,
  runWithCreateIdempotency,
  writeCreateIdempotency,
  type CreateJobIdempotency,
  type CreateJobResult,
} from "./generation-job-idempotency.js";
import {
  resolveLogicalSlots,
  type OutputSlotStatus,
} from "./generation-output-slot-repo.js";
import { appendProjectEvent } from "./product-event-repo.js";
import { cancelImageJob } from "./generation-image-cancel.js";
import {
  extraString,
  loadJobExtrasOne,
  setJobExtras,
} from "./generation-jobs-extra-repo.js";

/** 生成命令 repo（Prisma-backed）：创建/取消/重试生成任务 + 操作日志 + 点数预留。
 *  简化模型：一次任务一行（单输出语义，产出写 output_asset_ids JSON 数组）。
 *  对齐本仓 Java GenerationJobCommandService 的字段与状态语义，但不做多槽/幂等表。 */

export interface CreateJobInput {
  projectId: string;
  userId: string;
  type: "image" | "video" | "audio";
  expectedOutputCount: number;
  input: Record<string, unknown>;
  actionIdentity: string;
  actionType: string;
  /** 任务来源（generation_jobs.source）：默认 bottom_dock；视频计划应用走 plan，图片计划应用走 plan_apply。 */
  source?: string;
  /** 关联 PlanMessage（计划应用追溯用，写入日志 payload）。 */
  planMessageId?: string;
  /** IK67HE/T14：关联 SceneCardGenerationRecord（视频路径）；输出槽会绑定此 record 用于聚合。
   *  图片路径留空（槽位仍创建，仅 job 级聚合）。 */
  sceneCardGenerationRecordId?: string;
  /** SceneCard 来源身份；用于在 job 接纳时冻结实际 Canvas 位置与尺寸。 */
  sceneCardId?: string;
  /** IKIZQ8：两阶段视频阶段（契约 video-sample-mode.ts）。'sample' = 样片任务——
   *  落 video_stage 列并把 charge_state 置 'held'（创建即预扣）；缺省 = 普通视频，
   *  两列均 NULL（旧任务/普通视频投影缺省 video、费用为 null）。 */
  videoStage?: "sample";
}

/** createJob 的**调用参数**（区别于任务本身的数据）：事务复用与计费依赖。两者都是「每次
 *  调用」的东西——callerTx 属于调用方，计费依赖闭包了本次请求的模型与规格。 */
export interface CreateJobOptions {
  /** 复用调用方事务（如 plan apply 同 tx 建 job 行）；缺省自起 `$transaction`。
   *  ⚠️ 与 billing 同用时补偿只覆盖本方法内的失败：调用方事务在本方法返回**之后**才回滚
   *  的话，那笔预扣得由调用方自己退（当前没有这样的调用方——计划应用那条路不接计费）。
   *  ⚠️ 与 idempotency 同用时本方法**不做并发回读**：那侧事务归调用方，本方法不知道它的
   *  回滚意味着什么（当前没有这样的调用方——建任务路径自起事务）。 */
  callerTx?: Prisma.TransactionClient;
  /** ★ 新计费依赖（端口与补偿语义见 job-billing）。缺省不接 → 行为与改造前一致。 */
  billing?: JobBilling;
  /** 建任务幂等凭据（见 generation-job-idempotency）。缺省不接 → 行为与加幂等之前一致。 */
  idempotency?: CreateJobIdempotency;
}

export interface CreatedJob {
  generation_job_id: string;
  cursor: number;
}

export interface GenerationCommandRepo {
  /** 创建任务。`options.callerTx` 非空时复用调用方事务（如 plan apply 同 tx 建 job 行），
   *  否则自起 $transaction（CONTEXT：job 行可随业务事务原子创建，执行队列在提交后进入）。
   *  事务失败而预扣已成功时，会先把它**补偿返还**再抛错（见实现）。
   *
   *  `options.idempotency` 非空时接幂等：同键同摘要重放首次结果（不建行、不预扣），同键异
   *  摘要返回冲突；并发同键由唯一索引兜底。语义与并发细则见 generation-job-idempotency。
   *  缺省（客户端没带 Idempotency-Key）→ 完全不接，行为与加幂等表之前一致。 */
  createJob(
    input: CreateJobInput,
    options?: CreateJobOptions,
  ): Promise<CreateJobResult>;
  /** 建任务的幂等重放查询：同键同摘要 → 首次结果；同键异摘要 → 冲突；无行 → null。
   *
   *  ⚠️ 必须在**任何依赖当前状态的校验之前**调用（模型白名单、素材状态门、画布目标快照…
   *  都在它之后）：重放的是**既有结果**，不该被此刻的状态改写——与 retryJob 的
   *  `guardInput` 位置约定同源（见那里的说明）。 */
  lookupCreateIdempotency(
    projectId: string,
    idempotency: CreateJobIdempotency,
  ): Promise<CreateJobResult | null>;
  /** 图片取消原子收敛并撤销写入权；其他媒体登记软取消，由 worker 确认终态。 */
  requestCancel(jobId: string, userId: string): Promise<boolean>;
  /** 重试失败/缺失输出槽（IK67HE/T14，spec §4.4）：复用原参数快照，只补 failed/missing 槽，
   *  不覆盖成功输出。创建新 GenerationJob（retry_of_job_id 指向原 job），expected_output_count =
   *  需补槽数。接入 command_idempotency：同 Key 同摘要重放首次结果，同 Key 异摘要判冲突。
   *  返回值带 type，供路由按 image/video 重新入队。
   *  - 重放命中（同 Key 同摘要）→ 返回既有结果；
   *  - 冲突（同 Key 异摘要）→ 返回 { kind: "idempotency_conflict" }；
   *  - 原 job 不存在/非本人/已删除 → null（越权隐藏口径：与不存在同形，不泄露存在性）；
   *  - 原 job 存在但状态非终态 failed/partially_succeeded →
   *    { kind: "not_retryable_status" }（IKIPWU：真实原因外显，不再并成 null）；
   *  - 原 job 存在但无可补失败槽（失败项已全部由历史重试补成功）→
   *    { kind: "already_retried" }（IKIPWU：同上）。
   *
   *  IKF YHJ（ADR-0087 决策 7）：`guardInput` 在「确实要建新 job」的那一刻（幂等重放之后、
   *  create 之前）拿原 job 的 input 再过一次素材状态门。位置不能提前——重放是既有结果，
   *  不该被此刻的素材状态改写；也不能由调用方在事务外做——那样拿不到「是否重放」。
   *  返回非 null 字符串即拒绝，本方法返回 { kind: "material_blocked", reason }，
   *  不建行。 */
  retryJob(
    originalJobId: string,
    projectId: string,
    userId: string,
    idempotencyKey: string,
    requestHash: string,
    guardInput?: (
      input: Record<string, unknown>,
      jobType: string,
    ) => Promise<string | null>,
  ): Promise<
    | (CreatedJob & { type: "image" | "video" | "audio" })
    | { kind: "idempotency_conflict" }
    | { kind: "material_blocked"; reason: string }
    | { kind: "not_retryable_status" }
    | { kind: "already_retried" }
    | { kind: "finalize_retry_closed" }
    | null
  >;
  appendLog(
    jobId: string,
    event: string,
    status: string | null,
    message?: string,
    payload?: unknown,
  ): Promise<void>;
  /** 入队失败兜底（IKDZGH）：queued 任务置 failed——只改 queued 态，不改终态/在途。
   *  供 generation/media-extract 共用，消除两处重复的实现（本 repo 内规范化 updateMany）。 */
  markFailedQueued(
    jobId: string,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): Promise<void>;
}

export const SOURCE_BOTTOM_DOCK = "bottom_dock";

/** 视频任务的 strategy_version（video 分支兜底值）——建任务/重试/成片（IKIZQC
 *  finalize-repo）三处同源，改视频策略版本只动这一个常量。 */
export const VIDEO_STRATEGY_VERSION = "seedance-2.0-v1";

/** 建行时冻结的策略版本（IKJCOE：原 strategy_version 主表列已删，值由 type 决定）。
 *  视频/音频/图片各一个常量——所以重试路径**重算**而不是复制原行的值：
 *  复制只会把旧发布的常量续到新行上，重试是新建行，用当前常量才对。 */
export function strategyVersionOf(type: string): string {
  return type === "video"
    ? VIDEO_STRATEGY_VERSION
    : type === "audio"
      ? "audio-sync-v1"
      : "image-sync-v1";
}

/** 从 input 快照取建行时的输出数（IKJCOE：主表 expected_output_count 列已删；
 *  `input.expected_output_count` 建行时必写，是权威快照）。读不出来按 1 = 单输出兜底。 */
export function readInputCount(input: Prisma.JsonValue | null): number {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return 1;
  const n = Number((input as Record<string, unknown>).expected_output_count);
  return Number.isInteger(n) && n > 0 ? n : 1;
}


/** cost_reservations 的行值：只有**重试**会从原 job 的行里原样搬运一次，其余一律兜底。
 *
 *  ⚠️ 这张表是 new-api 记账时代的产物：列 `reserved_amount_fen` 的单位是**分**
 *     （那时值来自 quota→分 换算），四个 `*_version` 是当时的定价口径版本。
 *     new-api 已被切断、价格改由 billing 的 `Quote` 出，两个账本的单位无法在同一列里共存，
 *     所以**建任务不再写任何报价金额**——`reserved_amount_fen` 恒为 0、四版本恒为 "dev"。
 *     该表随 IKEF1K 整体下线，故不为此做列改名与存量数据迁移。
 *
 *  重试搬运是为了让同一批记账行在退役前保持自洽（逐列复制，不做任何单位解释或换算）。 */
interface LegacyReservationCarryOver {
  reserved_amount_fen: bigint;
  price_catalog_version: string;
  exchange_rate_version: string;
  model_policy_version: string;
  cost_rule_version: string;
}

function costReservationCreateData(
  carryOver: LegacyReservationCarryOver | null,
  jobId: bigint,
  userId: string,
  projectId: string,
  input: CreateJobInput,
): Prisma.cost_reservationsCreateArgs["data"] {
  return {
    generation_job_id: jobId,
    user_id: BigInt(userId),
    project_id: BigInt(projectId),
    action_identity: input.actionIdentity,
    action_type: input.actionType,
    provider: "volc",
    reserved_amount_fen: carryOver?.reserved_amount_fen ?? 0n,
    status: "reserved",
    price_catalog_version: carryOver?.price_catalog_version ?? "dev",
    exchange_rate_version: carryOver?.exchange_rate_version ?? "dev",
    model_policy_version: carryOver?.model_policy_version ?? "dev",
    cost_rule_version: carryOver?.cost_rule_version ?? "dev",
  };
}

/** 在调用方事务内创建 GenerationJob + cost 预留 + 日志 + 事件（IK67H9 抽出，让计划应用可组合进更大事务）。
 *  IK67HE/T14：同时固定 expectedOutputCount 个输出槽（status=pending），槽身份与顺序稳定。
 *  surgical：行为与原 createJob 内联实现完全一致，只是把事务体上提 + 增加槽位固定。
 *  预扣走 {@link JobBilling}（行为不进数据），其失败补偿由 createJob 统一兜——本函数只负责
 *  在正确的时点调用它。禁止行为进数据这道闸见 job-input-purity。
 *  幂等行走 {@link CreateJobIdempotency}（同样是行为、同样是每调一次的东西，不进 input）。 */
export async function createJobWithinTx(
  tx: Prisma.TransactionClient,
  input: CreateJobInput,
  billing?: JobBilling,
  idempotency?: CreateJobIdempotency,
): Promise<CreatedJob> {
  assertPureJobInput(input);
  if (input.input.prompt_plan_snapshot !== undefined) {
    const snapshot = promptPlanSnapshotSchema.parse(input.input.prompt_plan_snapshot);
    const rows = await tx.$queryRaw<Array<{ version: number }>>`SELECT version FROM canvas WHERE project_id = ${BigInt(input.projectId)} FOR UPDATE`;
    if (rows[0]?.version !== snapshot.canvasVersion) throw new NewApiError("Canvas 版本冲突，请保存后重新提交", 412);
    for (const image of [...snapshot.images.map(i => ({ ...i, type: "image", providerUrl: i.url })), ...(snapshot.videoReferences ?? [])].filter((ref): ref is typeof ref & { assetId: string } => Boolean(ref.assetId)).sort((a, b) => a.assetId.localeCompare(b.assetId))) {
      const assets = await tx.$queryRaw<Array<{ id: bigint; project_id: bigint; material_id: string | null }>>`SELECT id, project_id, material_id FROM assets WHERE id = ${BigInt(image.assetId)} AND user_id = ${BigInt(input.userId)} AND is_delete = false AND status = 'normal' AND type = ${image.type} AND url = ${image.url} FOR UPDATE`;
      const asset = assets[0];
      const links = asset && asset.project_id !== 0n && asset.project_id !== BigInt(input.projectId)
        ? await tx.$queryRaw<Array<{ asset_id: bigint }>>`SELECT asset_id FROM project_asset WHERE asset_id = ${BigInt(image.assetId)} AND project_id = ${BigInt(input.projectId)} AND user_id = ${BigInt(input.userId)} AND is_delete = 0 FOR UPDATE`
        : undefined;
      if (!asset || (links && links.length === 0) || (snapshot.videoReferences && (asset.material_id ? `asset://${asset.material_id}` : image.url) !== image.providerUrl)) {
        const indices = snapshot.plans.flatMap(p => p.mentions.filter(m => m.assetId === image.assetId).map(m => `#${m.index}`));
        throw new NewApiError(`素材索引 ${indices.join("、")} 已变化或不可用，请重新提交`, 400);
      }
    }
  }
  const now = new Date();
  const deadline = new Date(now.getTime() + 30 * 60 * 1000); // 30min 超时
  const frozenInput = await freezePlacementAnchor(tx, input);
  // IKJCOE：输出数**冻进 input 快照**——主表 expected_output_count 列已删，Worker 侧
  // （ImageJobProcessor）改从这里读「这次要出几个」。handle-create 那条路本来就写这个键
  // （值同源），本行对它是幂等的；补上是为了 storyboard_preview（count 默认 4）——
  // 它只把 count 当参数传进来、不写进 input 字面量，不补就会在 Worker 侧退化成 1，
  // 出图数比槽位数少。
  const jobInput = { ...frozenInput, expected_output_count: input.expectedOutputCount };
  const job = await tx.generation_jobs.create({
    data: {
      project_id: BigInt(input.projectId),
      user_id: BigInt(input.userId),
      type: input.type,
      source: input.source ?? SOURCE_BOTTOM_DOCK,
      status: "queued",
      progress: 0,
      input: jobInput as never,
      execution_deadline_at: deadline,
      next_action_at: now,
      fencing_token: 0,
    },
  });
  // IKJCOE：任务特有字段走扩展位（原主表列已删，见 ADR-0120）。
  //  · strategy_version 是建行时的策略版本快照——值由 type 决定，重试路径直接重算，
  //    不做「原样复制」（复制只会把旧发布的常量续到新行上）。
  // IKIZQ8：样片阶段身份与阶段费用初始态（held = 创建即预扣，见契约 §6）。
  await setJobExtras(tx, job.id, {
    strategy_version: strategyVersionOf(input.type),
    ...(input.videoStage !== undefined
      ? { video_stage: input.videoStage, charge_state: "held" }
      : {}),
  });
  // ★ 预扣：job 行已插入（id 已拿到），但事务未提交 —— 失败整体回滚，不留垃圾 job。
  //   若此后事务仍失败，由 createJob 的补偿把这一笔退掉（见那里的说明）。
  if (billing) {
    await billing.hold(Number(job.id));
  }

  // IK67HE/T14：固定输出槽（spec §4.4「输出槽位在首次提交时固定」）。
  if (input.expectedOutputCount > 0) {
    for (let i = 0; i < input.expectedOutputCount; i += 1) {
      await tx.generation_output_slots.create({
        data: {
          project_id: BigInt(input.projectId),
          generation_job_id: job.id,
          ...(input.sceneCardGenerationRecordId
            ? {
                scene_card_generation_record_id: BigInt(
                  input.sceneCardGenerationRecordId,
                ),
              }
            : {}),
          slot_index: i,
          status: "pending",
        },
      });
    }
  }
  await tx.cost_reservations.create({
    // 建任务不写金额（见 costReservationCreateData 的说明）：行照建，值走兜底。
    data: costReservationCreateData(
      null,
      job.id,
      input.userId,
      input.projectId,
      input,
    ),
  });
  await tx.generation_job_logs.create({
    data: {
      generation_job_id: job.id,
      event: "created",
      status: "queued",
      message: "任务已创建",
      payload: {
        // 载荷与 Prisma 入参是**同一个对象**，只能是纯数据（闸在 assertPureJobInput）。
        input,
        ...(input.planMessageId
          ? { plan_message_id: input.planMessageId }
          : {}),
      },
    } as never,
  });
  const event = await appendProjectEvent(tx, {
    projectId: input.projectId,
    eventType: "generation_job.created",
    aggregateType: "generation_job",
    aggregateId: job.id.toString(),
    aggregateVersion: job.version,
    correlationId: input.actionIdentity,
    payload: {
      job_id: job.id.toString(),
      type: job.type,
      source: job.source,
      status: job.status,
      progress: job.progress,
      output_asset_ids: [],
    },
  });
  // 幂等行与 job 行**同一个事务**（要不要写、写成什么见 generation-job-idempotency）。
  // 放在最后是因为它要存的是上面那条事件的游标——写在前面的行就没有游标可存。
  await writeCreateIdempotency(
    tx,
    { projectId: input.projectId, jobId: job.id, acceptedCursor: event.cursor },
    idempotency,
  );
  return {
    generation_job_id: job.id.toString(),
    cursor: Number(event.cursor),
  };
}

export function createGenerationCommandRepo(
  prisma: PrismaClient,
): GenerationCommandRepo {
  return {
    async createJob(input, options) {
      const idempotency = options?.idempotency;
      // callerTx 非空：复用调用方事务（plan apply 同 tx 建 job 行）；否则自起事务。
      // ★ 预扣与「事务失败就把它退掉」的补偿由 withBillingCompensation 兜住
      //   ——billing 是外部服务，不跟我们的回滚走（见 job-billing 的说明）。
      const run = () =>
        withBillingCompensation(options?.billing, (billing) =>
          options?.callerTx
            ? createJobWithinTx(options.callerTx, input, billing, idempotency)
            : prisma.$transaction(
                (tx) => createJobWithinTx(tx, input, billing, idempotency),
                { maxWait: 10_000, timeout: 30_000 },
              ),
        );
      // 幂等外壳（快路径重放 + 并发回读）只接在自起事务这条路上：callerTx 那侧的事务归
      // 调用方，本方法不知道它会不会回滚（见 options 说明）。
      return options?.callerTx
        ? run()
        : runWithCreateIdempotency(prisma, input.projectId, idempotency, run);
    },

    lookupCreateIdempotency(projectId, idempotency) {
      return readCreateIdempotency(prisma, projectId, idempotency);
    },

    async requestCancel(jobId, userId) {
      // 仅归属当前用户的 queued/processing 任务可取消。
      const job = await prisma.generation_jobs.findFirst({
        where: { id: BigInt(jobId), user_id: BigInt(userId), is_delete: false },
        select: { id: true, status: true, type: true },
      });
      if (job?.type === "image") return cancelImageJob(prisma, jobId, userId);
      if (!job || (job.status !== "queued" && job.status !== "processing"))
        return false;
      await prisma.generation_jobs.update({
        where: { id: BigInt(jobId) },
        data: { cancel_requested_at: new Date() },
      });
      await this.appendLog(
        jobId,
        "cancel_requested",
        job.status,
        "用户请求取消",
      );
      return true;
    },

    retryJob(
      originalJobId,
      projectId,
      userId,
      idempotencyKey,
      requestHash,
      guardInput,
    ) {
      return transactionWithUniqueRetry(
        prisma,
        async (tx) => {
        const pid = BigInt(projectId);
        const original = await tx.generation_jobs.findFirst({
          where: {
            id: BigInt(originalJobId),
            project_id: pid,
            user_id: BigInt(userId),
            is_delete: false,
          },
        });
        if (!original) return null;
        // IKJCOE：阶段身份在扩展位（原主表 video_stage 列已删）。整条重试路径共用这一次读。
        const originalExtras = await loadJobExtrasOne(tx, original.id.toString());
        // IKIZQC（G08）：成片任务不做同输入重试——首版不复用同一 Draft ID（IKIZPO 未证实），
        // 失败的成片行保留占位（来源唯一约束已锁住该样片的尝试），继续创作走「重新生成样片」。
        // 不拦的话会建出 video_stage='final' 却没有 source_sample_job_id 的孤儿行（Worker
        // 无从取得样片上游任务），且重试路径不接 Hold、终态结算会对无预留的 job 发事件。
        if (extraString(originalExtras, "video_stage") === "final") {
          return { kind: "finalize_retry_closed" } as const;
        }
        if (
          original.status !== "failed" &&
          original.status !== "partially_succeeded"
        ) {
          // IKIPWU：任务存在但状态不可重试——真实原因带出，不再并成 null 的「资源不存在」。
          return { kind: "not_retryable_status" } as const;
        }

        // IK7G9X：重试复用原 job 的记账快照（同一任务的重试，定价口径不变）。
        const originalReservation = await tx.cost_reservations.findFirst({
          where: { generation_job_id: original.id },
        });

        const operation = "generation.retry";
        const existing = idempotencyKey
          ? await tx.command_idempotency.findUnique({
              where: {
                project_id_operation_idempotency_key: {
                  project_id: pid,
                  operation,
                  idempotency_key: idempotencyKey,
                },
              },
              select: {
                request_hash: true,
                generation_job_id: true,
                accepted_cursor: true,
              },
            })
          : null;
        if (existing) {
          if (existing.request_hash !== requestHash) {
            return { kind: "idempotency_conflict" } as const;
          }
          return {
            generation_job_id: String(existing.generation_job_id),
            cursor: Number(existing.accepted_cursor),
            type: original.type as "image" | "video" | "audio",
          };
        }

        const allProjectSlots = await tx.generation_output_slots.findMany({
          where: { project_id: pid },
          orderBy: { id: "asc" },
        });
        const originalSlotIds = new Set(
          allProjectSlots
            .filter((slot) => slot.generation_job_id === original.id)
            .map((slot) => slot.id),
        );
        const retrySlotsByParent = new Map<
          bigint,
          Array<(typeof allProjectSlots)[number]>
        >();
        for (const slot of allProjectSlots) {
          if (slot.retry_of_slot_id === null) continue;
          const children = retrySlotsByParent.get(slot.retry_of_slot_id) ?? [];
          children.push(slot);
          retrySlotsByParent.set(slot.retry_of_slot_id, children);
        }
        const chainSlotIds = new Set(originalSlotIds);
        const pendingParents = [...originalSlotIds];
        for (let index = 0; index < pendingParents.length; index += 1) {
          for (const child of retrySlotsByParent.get(pendingParents[index]!) ??
            []) {
            if (!chainSlotIds.has(child.id)) {
              chainSlotIds.add(child.id);
              pendingParents.push(child.id);
            }
          }
        }
        const trackedSlots = allProjectSlots.filter((slot) =>
          chainSlotIds.has(slot.id),
        );
        const failedSlots = resolveLogicalSlots(
          trackedSlots.map((slot) => ({
            ...slot,
            status: slot.status as OutputSlotStatus,
          })),
        ).filter(
          (slot) => slot.status === "failed" || slot.status === "missing",
        );
        // IKIPWU：无可补失败槽（失败项已全部由历史重试补成功）——真实原因带出，不再并成 null。
        if (originalSlotIds.size > 0 && failedSlots.length === 0) {
          return { kind: "already_retried" } as const;
        }
        // IKJCOE：主表 expected_output_count 列已删——有槽位的按「要补几个失败槽」，
        // 无槽位行的历史 job 回落 input 快照（建行时必写）。
        const retryCount =
          originalSlotIds.size > 0
            ? failedSlots.length
            : readInputCount(original.input);

        // IKF YHJ（ADR-0087 决策 7）：重试复用原 job 的参数快照，但那批素材的校验状态
        // 可能在首次生成之后变了（撤销/删除/失败）。采纳之前重过一道门，拒绝就不建行。
        if (guardInput) {
          const reason = await guardInput(
            (original.input ?? {}) as Record<string, unknown>,
            original.type,
          );
          if (reason !== null) return { kind: "material_blocked", reason } as const;
        }

        const now = new Date();
        const deadline = new Date(now.getTime() + 30 * 60 * 1000);
        const retry = await tx.generation_jobs.create({
          data: {
            project_id: pid,
            user_id: original.user_id,
            type: original.type,
            source: original.source,
            status: "queued",
            progress: 0,
            input: original.input as never,
            retry_of_job_id: original.id,
            execution_deadline_at: deadline,
            next_action_at: now,
            fencing_token: 0,
          },
        });
        // IKJCOE：任务特有字段进扩展位（原主表列已删）。
        // IKIZQ8：样片重试继承阶段身份（input.sample_mode 已随快照复制，Worker 行为
        // 按样片语义执行；阶段不继承会让投影把样片重试显示成普通视频）。
        // charge_state 不在此置 held：重试路径本就不接 Hold（既有口径，全类型一致），
        // 终态守卫按两阶段条件写 settled/released。
        const inheritedStage = extraString(originalExtras, "video_stage");
        await setJobExtras(tx, retry.id, {
          // M2（评审）：策略版本沿用原行冻结的那份（原先就是 original.strategy_version ?? 兜底），
          // 只有拿不到才按 type 重算——「值随发布变化」正是它要作 per-job 快照的理由。
          strategy_version:
            extraString(originalExtras, "strategy_version") ??
            strategyVersionOf(original.type),
          ...(inheritedStage !== null ? { video_stage: inheritedStage } : {}),
        });
        // 为重试 job 补 cost_reservations 行：原 job 有行就逐列搬运（见 costReservationCreateData），
        // 没有就与建任务同款兜底。这张退役表不参与本次的计费口径变更。
        const retryInput: CreateJobInput = {
          projectId,
          userId: original.user_id.toString(),
          type: original.type as "image" | "video" | "audio",
          expectedOutputCount: retryCount,
          input: (original.input ?? {}) as Record<string, unknown>,
          actionIdentity: idempotencyKey || `retry:${originalJobId}`,
          actionType:
            original.type === "video"
              ? "generate_video"
              : original.type === "audio"
                ? "generate_audio"
                : "generate_image",
        };
        await tx.cost_reservations.create({
          data: costReservationCreateData(
            originalReservation
              ? {
                  reserved_amount_fen:
                    originalReservation.reserved_amount_fen ?? 0n,
                  price_catalog_version:
                    originalReservation.price_catalog_version,
                  exchange_rate_version:
                    originalReservation.exchange_rate_version,
                  model_policy_version:
                    originalReservation.model_policy_version,
                  cost_rule_version: originalReservation.cost_rule_version,
                }
              : null,
            retry.id,
            original.user_id.toString(),
            projectId,
            retryInput,
          ),
        });
        // 为重试 job 创建新槽，链 retry_of_slot_id 指向被补的原始槽。
        if (failedSlots.length > 0) {
          const recordIds = new Set<bigint>();
          for (const orig of failedSlots) {
            await tx.generation_output_slots.create({
              data: {
                project_id: pid,
                generation_job_id: retry.id,
                ...(orig.scene_card_generation_record_id
                  ? {
                      scene_card_generation_record_id:
                        orig.scene_card_generation_record_id,
                    }
                  : {}),
                slot_index: orig.slot_index,
                status: "pending",
                retry_of_slot_id: orig.id,
              },
            });
            if (orig.scene_card_generation_record_id) {
              recordIds.add(orig.scene_card_generation_record_id);
            }
          }
          for (const recordId of recordIds) {
            const record = await tx.scene_card_generation_records.update({
              where: { id: recordId },
              data: {
                summary_status: "generating",
                version: { increment: 1 },
              },
            });
            await appendProjectEvent(tx, {
              projectId: record.project_id.toString(),
              eventType: "scene_card_generation_record.summary_changed",
              aggregateType: "scene_card_generation_record",
              aggregateId: recordId.toString(),
              aggregateVersion: record.version,
              correlationId: `record_${recordId.toString()}`,
              payload: {
                record_id: recordId.toString(),
                summary_status: "generating",
              },
            });
          }
        } else {
          // 早于 T14 的 job 无槽位：退化为按 expected_output_count 建槽（向后兼容）。
          for (let i = 0; i < retryCount; i += 1) {
            await tx.generation_output_slots.create({
              data: {
                project_id: pid,
                generation_job_id: retry.id,
                slot_index: i,
                status: "pending",
              },
            });
          }
        }
        const event = await appendProjectEvent(tx, {
          projectId,
          eventType: "generation_job.created",
          aggregateType: "generation_job",
          aggregateId: retry.id.toString(),
          aggregateVersion: retry.version,
          correlationId: idempotencyKey || `retry:${originalJobId}`,
          payload: {
            job_id: retry.id.toString(),
            type: retry.type,
            source: retry.source,
            status: retry.status,
            progress: retry.progress,
            output_asset_ids: [],
            retry_of_job_id: originalJobId,
          },
        });
        if (idempotencyKey) {
          await tx.command_idempotency.create({
            data: {
              project_id: pid,
              operation,
              idempotency_key: idempotencyKey,
              request_hash: requestHash,
              generation_job_id: retry.id,
              resource_id: BigInt(originalJobId),
              accepted_cursor: BigInt(event.cursor),
            },
          });
        }
        await tx.generation_job_logs.create({
          data: {
            generation_job_id: retry.id,
            event: "retry_created",
            status: "queued",
            message: `重试 ${originalJobId}`,
          },
        });
        return {
          generation_job_id: retry.id.toString(),
          cursor: Number(event.cursor),
          type: original.type as "image" | "video" | "audio",
        };
        },
        // 素材门（guardInput）在事务内发 HTTP，默认 5s 的交互事务超时会把它掐成 P2028/500。
        // 与 createJob 同口径放宽（那里也是同一理由：事务里含外部等待）。
        { maxWait: 10_000, timeout: 30_000 },
      );
    },

    async appendLog(jobId, event, status, message, payload) {
      const data: Record<string, unknown> = {
        generation_job_id: BigInt(jobId),
        event,
        status,
      };
      if (message !== undefined) data.message = message;
      if (payload !== undefined) data.payload = payload as never;
      await prisma.generation_job_logs.create({ data: data as never });
    },

    async markFailedQueued(jobId, code, message, details) {
      // 与原先两处 service 内联的 updateMany 行为一致（IKDZGH 收敛到 repo，消除裸查/重复）。
      // error 为 Prisma JSON 字段：显式构建对象（avoid optional spread），值按 JSON 契约强转。
      const error: Record<string, unknown> = { code, message };
      if (details !== undefined) error.details = details;
      await prisma.generation_jobs.updateMany({
        where: { id: BigInt(jobId), status: "queued" },
        data: {
          status: "failed",
          error: error as Prisma.InputJsonValue,
          next_action_at: null,
          version: { increment: 1 },
        },
      });
    },
  };
}
