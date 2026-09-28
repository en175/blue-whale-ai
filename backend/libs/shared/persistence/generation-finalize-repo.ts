import { assertPureJobInput } from "./job-input-purity.js";
import { withBillingCompensation, type JobBilling } from "./job-billing.js";
import type { CreatedJob } from "./generation-command-repo.js";
import {
  FINALIZE_GENERATION_JOB_OPERATION,
  readCreateIdempotency,
  runWithCreateIdempotency,
  writeCreateIdempotency,
  type CreateJobIdempotency,
  type CreateJobResult,
} from "./generation-job-idempotency.js";
import { appendProjectEvent } from "./product-event-repo.js";
import type { PrismaClient } from "@prisma/client";

/** IKIZQC：成片（finalize）命令 repo——从已成功交付的样片派生 1080p 成片任务。
 *
 *  与 {@link generation-command-repo} 分文件的原因：那个文件贴着 800 行 eslint 硬线，
 *  而成片链路的事务形状与建任务不同（不读画布、不冻落位锚点、多一笔回写
 *  `final_job_id`、多一个来源唯一约束的裁决），不值得为复用十行公共代码把两条链路
 *  拧在一起。计费补偿、幂等外壳、cost_reservations 兜底行等**机制**全部复用原实现。
 *
 *  并发语义（金标 G05）：同一来源样片的双击/两页并发（不同 Idempotency-Key）由
 *  `uk_generation_jobs__source_sample_job_id` 在数据库层原子裁决——输家在 job 行插入
 *  那一刻 P2002 回滚（预扣发生在插入**之后**，输家根本走不到 Hold），返回
 *  `finalize_already_attempted`。同键重放由 command_idempotency（operation=
 *  generation.finalize）重放首次结果。 */

/** 成片来源（样片）读取投影——finalize 报价与提交前置校验需要的全部列。 */
export interface FinalizeSourceJob {
  id: string;
  project_id: string;
  user_id: string;
  status: string;
  type: string;
  video_stage: string | null;
  final_job_id: string | null;
  finalize_deadline_ms: bigint | null;
  /** 已转存判定：publishVideoResult 在同事务里写 output_asset_ids 与 succeeded。 */
  output_asset_ids: PrismaJsonArray | null;
  input: Record<string, unknown>;
}

/** Prisma JSON 列的最小形状（避免在 repo 层展开 JsonValue 联合类型）。 */
export type PrismaJsonArray = unknown[] | { toJSON?: () => unknown };

export interface CreateFinalizeJobInput {
  projectId: string;
  userId: string;
  /** 来源样片任务 ID（写入 source_sample_job_id，撞唯一约束即 already_attempted）。 */
  sourceSampleJobId: string;
  /** 从样片冻结输入派生的 1080p 快照（deriveFinalizeInput 产出，纯数据）。 */
  input: Record<string, unknown>;
  actionIdentity: string;
  actionType: string;
}

/** 成片提交结果：正常建了行，或来源已被占（G05 后到请求的裁决）。 */
export type FinalizeJobResult =
  | CreatedJob
  | { kind: "finalize_already_attempted" }
  | Extract<CreateJobResult, { kind: "idempotency_conflict" }>;

/** 读来源样片（本人 + 本项目；越权与不存在同形返回 null，不泄露存在性）。 */
export async function findFinalizeSourceJob(
  prisma: PrismaClient,
  args: { projectId: string; userId: string; jobId: string },
): Promise<FinalizeSourceJob | null> {
  const row = await prisma.generation_jobs.findFirst({
    where: {
      id: BigInt(args.jobId),
      project_id: BigInt(args.projectId),
      user_id: BigInt(args.userId),
      is_delete: false,
    },
    select: {
      id: true,
      project_id: true,
      user_id: true,
      status: true,
      type: true,
      video_stage: true,
      final_job_id: true,
      finalize_deadline_ms: true,
      output_asset_ids: true,
      input: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id.toString(),
    project_id: row.project_id?.toString() ?? "0",
    user_id: row.user_id.toString(),
    status: row.status,
    type: row.type,
    video_stage: row.video_stage,
    final_job_id: row.final_job_id?.toString() ?? null,
    finalize_deadline_ms: row.finalize_deadline_ms,
    output_asset_ids: (row.output_asset_ids ?? null) as PrismaJsonArray | null,
    input: (row.input ?? {}) as Record<string, unknown>,
  };
}

/** Prisma P2002 且撞的是来源唯一索引（command_idempotency 的并发同键走幂等回读，
 *  不该走到这里——走到说明是不同键，正是来源已被占）。 */
function isSourceUniqueViolation(error: unknown): boolean {
  if ((error as { code?: string } | null)?.code !== "P2002") return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (!Array.isArray(target)) return true;
  return target.map(String).includes("source_sample_job_id");
}

/**
 * 建成片任务：job 行（video_stage='final' + source_sample_job_id + charge_state='held'）
 * + 预扣 + 输出槽 + cost_reservations 兜底行 + 日志/事件 + 样片行 final_job_id 回写，
 * 全部同一事务；来源唯一约束裁决并发。
 */
export async function createFinalizeJob(
  prisma: PrismaClient,
  input: CreateFinalizeJobInput,
  options?: { billing?: JobBilling; idempotency?: CreateJobIdempotency },
): Promise<FinalizeJobResult> {
  try {
    return await runWithCreateIdempotency(
      prisma,
      input.projectId,
      options?.idempotency,
      () =>
        withBillingCompensation(options?.billing, (billing) =>
          prisma.$transaction(
            (tx) => createFinalizeJobWithinTx(tx, input, billing, options?.idempotency),
            { maxWait: 10_000, timeout: 30_000 },
          ),
        ),
      FINALIZE_GENERATION_JOB_OPERATION,
    );
  } catch (error) {
    if (isSourceUniqueViolation(error)) {
      // G05：双击/两页并发——数据库只放一条成片任务进，输家整体回滚（未预扣）。
      return { kind: "finalize_already_attempted" };
    }
    throw error;
  }
}

async function createFinalizeJobWithinTx(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  input: CreateFinalizeJobInput,
  billing: JobBilling | undefined,
  idempotency: CreateJobIdempotency | undefined,
): Promise<CreatedJob> {
  assertPureJobInput({ input: input.input });
  const now = new Date();
  const deadline = new Date(now.getTime() + 30 * 60 * 1000);
  const job = await tx.generation_jobs.create({
    data: {
      project_id: BigInt(input.projectId),
      user_id: BigInt(input.userId),
      type: "video",
      source: "bottom_dock",
      status: "queued",
      progress: 0,
      input: input.input as never,
      expected_output_count: 1,
      action_identity: input.actionIdentity,
      project_action_identity: input.actionIdentity,
      strategy_version: "seedance-2.0-v1",
      execution_deadline_at: deadline,
      next_action_at: now,
      fencing_token: 0,
      // 契约 §1/§6：成片阶段身份 + 来源指向 + 创建即预扣。唯一索引在这一刻裁决并发。
      video_stage: "final",
      source_sample_job_id: BigInt(input.sourceSampleJobId),
      charge_state: "held",
    },
  });
  // ★ 预扣与 job 行同事务（job 行插入后、提交前）：来源唯一冲突在上一行就已回滚，
  //   走到这里的事务都是赢家；此后若事务失败，补偿把这笔冻结退掉（机制同建任务）。
  if (billing) {
    await billing.hold(Number(job.id));
  }
  await tx.generation_output_slots.create({
    data: {
      project_id: BigInt(input.projectId),
      generation_job_id: job.id,
      slot_index: 0,
      status: "pending",
    },
  });
  await tx.cost_reservations.create({
    // 与建任务同款兜底（该表已退役、金额走 billing，行照建保持自洽）。
    data: {
      generation_job_id: job.id,
      user_id: BigInt(input.userId),
      project_id: BigInt(input.projectId),
      action_identity: input.actionIdentity,
      action_type: input.actionType,
      provider: "volc",
      reserved_amount_fen: 0n,
      status: "reserved",
      price_catalog_version: "dev",
      exchange_rate_version: "dev",
      model_policy_version: "dev",
      cost_rule_version: "dev",
    },
  });
  // 样片行回写 final_job_id（G11 投影互指；带 final_job_id IS NULL 守卫——非 NULL 说明
  // 另一并发已回写，但那种情形下唯一索引早已拦下本事务，这里只是防御性幂等）。
  await tx.generation_jobs.updateMany({
    where: { id: BigInt(input.sourceSampleJobId), final_job_id: null },
    data: { final_job_id: job.id },
  });
  await tx.generation_job_logs.create({
    data: {
      generation_job_id: job.id,
      event: "finalize_created",
      status: "queued",
      message: `成片任务已创建（来源样片 ${input.sourceSampleJobId}）`,
      payload: {
        source_sample_job_id: input.sourceSampleJobId,
        input: input.input,
      } as never,
    },
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
      video_stage: "final",
      source_sample_job_id: input.sourceSampleJobId,
    },
  });
  await writeCreateIdempotency(
    tx,
    { projectId: input.projectId, jobId: job.id, acceptedCursor: event.cursor },
    idempotency,
    FINALIZE_GENERATION_JOB_OPERATION,
  );
  return { generation_job_id: job.id.toString(), cursor: Number(event.cursor) };
}

/** 成片命令端口（handler 依赖这一面；实现即本文件的 Prisma 装配）。 */
export interface FinalizeCommandRepo {
  findFinalizeSourceJob(args: {
    projectId: string;
    userId: string;
    jobId: string;
  }): Promise<FinalizeSourceJob | null>;
  createFinalizeJob(
    input: CreateFinalizeJobInput,
    options?: { billing?: JobBilling; idempotency?: CreateJobIdempotency },
  ): Promise<FinalizeJobResult>;
  /** 幂等重放查询（operation=generation.finalize）——必须在状态校验之前调用。
   *  同键同摘要 → 首次结果；同键异摘要 → idempotency_conflict（调用方判冲突）。 */
  lookupFinalizeIdempotency(
    projectId: string,
    idempotency: CreateJobIdempotency,
  ): Promise<CreateJobResult | null>;
}

/** 成片命令 repo 工厂（FinalizeCommandRepo 端口的 Prisma 实现）。 */
export function createFinalizeCommandRepo(prisma: PrismaClient): FinalizeCommandRepo {
  return {
    findFinalizeSourceJob: (args) => findFinalizeSourceJob(prisma, args),
    createFinalizeJob: (input, options) => createFinalizeJob(prisma, input, options),
    lookupFinalizeIdempotency: (projectId, idempotency) =>
      readCreateIdempotency(prisma, projectId, idempotency, FINALIZE_GENERATION_JOB_OPERATION),
  };
}
