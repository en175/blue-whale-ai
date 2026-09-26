/* ============================================
 * 建任务幂等（`command_idempotency`，operation=generation.create）
 *
 * 存在的理由：幂等是「读 + 判定 + 并发回读」三件成套的机制，而 generation-command-repo
 * 已经贴着 800 行硬线（eslint.config.mjs 的 max-lines 无豁免）。机制收在这里，
 * repo 只留「在正确的时点调用它」。
 *
 * 语义（与客户端约定的那一套）：
 *   · 同键同摘要 → 重放**首次结果**（同一个 generation_job_id），不建行、不预扣；
 *   · 同键异摘要 → 客户端 bug（同一把钥匙配了不同载荷），判冲突交调用方拒绝；
 *   · 没带键    → 完全不接幂等，行为与加幂等表之前一致（不强制要求这个头）。
 *
 * ⚠️ 幂等键必须来自**客户端**（请求头 Idempotency-Key），不能从我们自己生成的 id 派生——
 * 这是 billing.proto `HoldRequest.command_id` 那条设计意图的同一条要求：幂等键的来源在
 * 客户端，重试才可能带上同一把钥匙。
 * ============================================ */
import type { Prisma, PrismaClient } from "@prisma/client";

import type { CreatedJob } from "./generation-command-repo.js";

/** 建任务的幂等域（command_idempotency.operation）。已建库里的行也写这个值，不可改。 */
export const CREATE_GENERATION_JOB_OPERATION = "generation.create";

/** 建任务的幂等凭据。两者必须一起给：只有 key 能防重复建行，只有摘要能判「同键异载荷」。 */
export interface CreateJobIdempotency {
  key: string;
  /** 请求摘要（sha256 hex，64 字符，对齐 request_hash 列宽）。 */
  requestHash: string;
}

/** 建任务的结果：正常建了行，或「同键异载荷」冲突（与 retryJob 同款判别式）。 */
export type CreateJobResult = CreatedJob | { kind: "idempotency_conflict" };

/** 事务里写幂等行的入参（列值都从建任务这边来）。 */
interface CreateIdempotencyWrite {
  projectId: string;
  jobId: bigint;
  /** 建 job 那条事件的游标（重放时原样还给客户端）。事件视图把它渲染成字符串形式的雪花 id。 */
  acceptedCursor: string;
}

/** 写幂等行。**必须与 job 行同一个事务**：要么一起在，要么一起不在——重放要拿到的是同一个
 *  job_id，行在而 job 不在就无从重放。它同时是并发同键的唯一闸：唯一索引
 *  uk_command_idempotency 只放一个事务进，输家整体回滚（预扣由调用方的补偿退掉）。 */
export async function writeCreateIdempotency(
  tx: Prisma.TransactionClient,
  write: CreateIdempotencyWrite,
  idempotency: CreateJobIdempotency | undefined,
): Promise<void> {
  if (!idempotency) return;
  await tx.command_idempotency.create({
    data: {
      project_id: BigInt(write.projectId),
      operation: CREATE_GENERATION_JOB_OPERATION,
      idempotency_key: idempotency.key,
      request_hash: idempotency.requestHash,
      generation_job_id: write.jobId,
      accepted_cursor: BigInt(write.acceptedCursor),
    },
  });
}

/** 幂等行的一次性读：有行 → 重放/冲突，无行 → null。 */
export async function readCreateIdempotency(
  prisma: PrismaClient,
  projectId: string,
  idempotency: CreateJobIdempotency,
): Promise<CreateJobResult | null> {
  const row = await prisma.command_idempotency.findUnique({
    where: {
      project_id_operation_idempotency_key: {
        project_id: BigInt(projectId),
        operation: CREATE_GENERATION_JOB_OPERATION,
        idempotency_key: idempotency.key,
      },
    },
    select: {
      request_hash: true,
      generation_job_id: true,
      accepted_cursor: true,
    },
  });
  if (!row) return null;
  if (row.request_hash !== idempotency.requestHash) {
    return { kind: "idempotency_conflict" };
  }
  if (row.generation_job_id === null) {
    // 不变式：这行与 job 行同事务写入，提交了就必然带着 job id（回放靠它）。
    // 真撞上说明数据被外部改过，宁可报错也不要回一个不知指向哪里的成功。
    throw new Error(
      `幂等行缺少 generation_job_id：project=${projectId} operation=${CREATE_GENERATION_JOB_OPERATION}`,
    );
  }
  return {
    generation_job_id: row.generation_job_id.toString(),
    cursor: Number(row.accepted_cursor),
  };
}

/**
 * 幂等外壳：先查一次（命中就重放，`run` 根本不会被执行 —— 这正是「命中幂等就不再扣一次钱」
 * 的落点），否则跑 `run`；`run` 抛错时回读一次，读得到赢家就按幂等语义把它的结果交出去。
 *
 * ⚠️ 回读发生在**任何错误**上，不只在唯一键冲突上。并发同键时输家那次失败可能长得不像
 * 冲突（余额刚好只够一笔时它会以「余额不足」失败，因为赢家已经把钱冻住了）——但那仍然是
 * 「同键并发」，正确答案依然是重放赢家的结果。
 *
 * ⚠️ 这里**不能**照 video-scene-splits / retryJob 那样用 transactionWithUniqueRetry
 * （撞唯一键就把整个事务重跑一遍）：那些路径的事务里只有本地行，重跑等于重来；而建任务的
 * 事务里有一次**外部**预扣，重跑会带着同一个 commandId 去冻第二个 job_id —— billing 的
 * 幂等记录是永久的、重放时按 job_id 找预留，找不到就抛 IllegalStateException
 * （见 handle-create-generation-job 里 actionIdentity 那段）。所以这里只回读、不重跑。
 */
export async function runWithCreateIdempotency(
  prisma: PrismaClient,
  projectId: string,
  idempotency: CreateJobIdempotency | undefined,
  run: () => Promise<CreateJobResult>,
): Promise<CreateJobResult> {
  if (!idempotency) return run();
  const replayed = await readCreateIdempotency(prisma, projectId, idempotency);
  if (replayed) return replayed;
  try {
    return await run();
  } catch (error) {
    const winner = await readCreateIdempotency(prisma, projectId, idempotency);
    if (winner) return winner;
    throw error;
  }
}
