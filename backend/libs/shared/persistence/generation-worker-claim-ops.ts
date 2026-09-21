// IK74V8：从 generation-worker-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 任务领取与重排：图片/视频作业的 CAS 领取、租约回收、重试重排。
import type {PrismaClient} from "@prisma/client";

import {CLAIMABLE_JOB_SOURCES, imageJobLeaseSeconds} from "./generation-worker-internals.js";
import type {WorkerRepo} from "./generation-worker-types.js";

/** IKBBXH：recovery 兜底只捞创建 RECOVERY_MAX_AGE_MS 内的任务，避免卡死任务被 60s 循环无限重放。 */
const RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** IK9VZ0：视频实扣二次校验用——读 job 当前预留金额（fen）。查询失败/无预留 → null，不阻塞认领。 */
async function loadReservationFen(
  prisma: PrismaClient,
  jobId: bigint,
): Promise<bigint | null> {
  try {
    const row = await prisma.cost_reservations.findFirst({
      where: { generation_job_id: jobId, is_delete: 0 },
      select: { reserved_amount_fen: true },
    });
    return row ? row.reserved_amount_fen : null;
  } catch {
    return null;
  }
}

export function createWorkerClaimOps(prisma: PrismaClient): Pick<
  WorkerRepo,
  | "claimJobById"
  | "claimNextJob"
  | "listDueVideoJobIds"
  | "listDueImageJobIds"
  | "listDueMediaExtractJobIds"
  | "listDueAudioJobIds"
  | "claimVideoJobById"
  | "claimImageJobById"
  | "claimAudioJobById"
  | "claimMediaExtractJobById"
  | "resetStalledImageJobs"
  | "claimNextImageJob"
  | "claimNextInProcessJob"
  | "requeueImageJobForRetry"
  | "claimNextVideoJob"
> {
  // 与拆分前一致：每次创建仓储时读一次 IMAGE_JOB_LEASE_SECONDS。
  const LEASE_SECONDS = imageJobLeaseSeconds();

  // IK7GRQ：图片 claim 三族合一。queued 任务的领取语义（候选查询 → CAS 条件含 fencing_token
  // → 置 processing + 租约 + 递增 fencing_token/version → 返回 ClaimedJob）单点实现于此，
  // claimJobById / claimNextJob / claimNextImageJob 仅以候选查询条件差异化调用。纯重构，行为不变。
  async function claimQueuedJob(
    workerId: string,
    candidateWhere: Record<string, unknown>,
    options?: { orderBy?: Record<string, unknown>; casUserId?: string },
  ) {
    const findFirstArgs: { where: Record<string, unknown>; orderBy?: Record<string, unknown> } = {
      where: candidateWhere,
    };
    if (options?.orderBy) {
      findFirstArgs.orderBy = options.orderBy;
    }
    const candidate = await prisma.generation_jobs.findFirst(findFirstArgs);
    if (!candidate) return null;

    const now = new Date();
    const lease = new Date(now.getTime() + LEASE_SECONDS * 1000);
    // CAS 条件：命中候选 id + queued + 读到的 fencing_token（+byId 再锁 user_id）。领取成功递增并发给 worker。
    const casWhere: Record<string, unknown> = {
      id: candidate.id,
      status: "queued",
      fencing_token: candidate.fencing_token,
    };
    if (options?.casUserId !== undefined) {
      casWhere.user_id = BigInt(options.casUserId);
    }
    const claimed = await prisma.generation_jobs
      .updateMany({
        where: casWhere,
        data: {
          status: "processing",
          lease_owner: workerId,
          lease_expires_at: lease,
          last_polled_at: now,
          fencing_token: { increment: 1 },
          version: { increment: 1 },
        },
      })
      .catch(() => ({ count: 0 }));
    if (claimed.count === 0) return null;
    return {
      id: candidate.id.toString(),
      project_id: candidate.project_id?.toString() ?? "0",
      user_id: candidate.user_id.toString(),
      type: candidate.type,
      input: (candidate.input as Record<string, unknown> | null) ?? null,
      expected_output_count: candidate.expected_output_count ?? 1,
      retry_count: candidate.retry_count ?? 0,
      cancelRequested: candidate.cancel_requested_at != null,
      fencingToken: Number(candidate.fencing_token + 1n),
    };
  }

  return {
    async claimJobById(jobId, userId, workerId) {
      // IK7GRQ：薄封装——byId + userId 精确领取，候选查询锁 id/user_id，CAS 再锁 user_id。
      return claimQueuedJob(
        workerId,
        {
          id: BigInt(jobId),
          user_id: BigInt(userId),
          status: "queued",
          is_delete: false,
          source: { in: CLAIMABLE_JOB_SOURCES },
          next_action_at: { lte: new Date() },
        },
        { casUserId: userId },
      );
    },

    async claimNextJob(workerId) {
      // IK7GRQ：薄封装——认领一条 queued 且到点的（不限 type），按 id asc。
      return claimQueuedJob(
        workerId,
        {
          status: "queued",
          is_delete: false,
          source: { in: CLAIMABLE_JOB_SOURCES },
          next_action_at: { lte: new Date() },
        },
        { orderBy: { id: "asc" } },
      );
    },

    async listDueVideoJobIds(limit) {
      const now = new Date();
      const rows = await prisma.generation_jobs.findMany({
        where: {
          type: "video",
          source: { in: ["bottom_dock", "plan_apply", "plan", "scene_card"] },
          is_delete: false,
          // IKBBXH：recovery 兜底只捞创建 1 天内的任务，避免卡死任务被 60s 循环无限重放。
          gmt_create: { gt: new Date(now.getTime() - RECOVERY_MAX_AGE_MS) },
          next_action_at: { lte: now },
          OR: [
            { status: "queued" },
            {
              status: "processing",
              OR: [
                { lease_expires_at: null },
                { lease_expires_at: { lt: now } },
              ],
            },
          ],
        },
        orderBy: { id: "asc" },
        take: Math.max(1, Math.min(500, limit)),
        select: { id: true },
      });
      return rows.map((row) => row.id.toString());
    },

    async listDueImageJobIds(limit) {
      // IKBGKA（review 2 轮）：图片到点/孤儿 job 低频补入队扫描——镜像 listDueVideoJobIds。
      // 与视频同构：queued（含漏入队：enqueue 失败/重启丢失）或 processing+lease 过期（孤儿）
      // 且创建 1 天内的图片 job 重新入队，让 MQ 消费端（Semaphore 背压）统一处理。
      const now = new Date();
      const rows = await prisma.generation_jobs.findMany({
        where: {
          type: "image",
          source: { in: CLAIMABLE_JOB_SOURCES },
          is_delete: false,
          gmt_create: { gt: new Date(now.getTime() - RECOVERY_MAX_AGE_MS) },
          next_action_at: { lte: now },
          OR: [
            { status: "queued" },
            {
              status: "processing",
              OR: [
                { lease_expires_at: null },
                { lease_expires_at: { lt: now } },
              ],
            },
          ],
        },
        orderBy: { id: "asc" },
        take: Math.max(1, Math.min(500, limit)),
        select: { id: true },
      });
      return rows.map((row) => row.id.toString());
    },

    async listDueMediaExtractJobIds(limit) {
      // IKC9EJ：媒体提取到点/孤儿 job 低频补入队扫描——镜像 listDueImageJobIds。
      // 与图片同构：queued（含漏入队：enqueue 失败/消息丢失）或 processing+lease 过期（孤儿）
      // 且创建 1 天内的任务重新入队，让 MQ 消费端（Semaphore 背压）统一处理。
      // 注意：media_extract 的 source="dock" 不在 CLAIMABLE_JOB_SOURCES 白名单，
      // claimMediaExtractJobById 也只按 type 过滤——本扫描同样只按 type 捞，不套 source 白名单，
      // 否则漏掉真正卡住的任务（IKC9EJ）。
      const now = new Date();
      const rows = await prisma.generation_jobs.findMany({
        where: {
          type: "media_extract",
          is_delete: false,
          gmt_create: { gt: new Date(now.getTime() - RECOVERY_MAX_AGE_MS) },
          next_action_at: { lte: now },
          OR: [
            { status: "queued" },
            {
              status: "processing",
              OR: [
                { lease_expires_at: null },
                { lease_expires_at: { lt: now } },
              ],
            },
          ],
        },
        orderBy: { id: "asc" },
        take: Math.max(1, Math.min(500, limit)),
        select: { id: true },
      });
      return rows.map((row) => row.id.toString());
    },

    async listDueAudioJobIds(limit) {
      // IKCR78：音频到点/孤儿 job 低频补入队扫描——镜像 listDueImageJobIds（type=audio）。
      // queued（含漏入队：enqueue 失败/消息丢失）或 processing+lease 过期（孤儿）且创建 1 天内的
      // 音频 job 重新入队，让 MQ 消费端（Semaphore 背压）统一处理。
      // 不套 source 白名单（仿 media_extract IKC9EJ 教训）：防未来非白名单 source 的音频 job 被漏捞；
      // 重复补入队由 claim-by-id CAS 幂等兜底，无副作用。
      const now = new Date();
      const rows = await prisma.generation_jobs.findMany({
        where: {
          type: "audio",
          is_delete: false,
          gmt_create: { gt: new Date(now.getTime() - RECOVERY_MAX_AGE_MS) },
          next_action_at: { lte: now },
          OR: [
            { status: "queued" },
            {
              status: "processing",
              OR: [
                { lease_expires_at: null },
                { lease_expires_at: { lt: now } },
              ],
            },
          ],
        },
        orderBy: { id: "asc" },
        take: Math.max(1, Math.min(500, limit)),
        select: { id: true },
      });
      return rows.map((row) => row.id.toString());
    },

    async claimVideoJobById(jobId, workerId) {
      const now = new Date();
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          id: BigInt(jobId),
          type: "video",
          source: { in: ["bottom_dock", "plan_apply", "plan", "scene_card"] },
          is_delete: false,
          next_action_at: { lte: now },
          OR: [
            { status: "queued" },
            {
              status: "processing",
              OR: [
                { lease_expires_at: null },
                { lease_expires_at: { lt: now } },
              ],
            },
          ],
        },
        orderBy: { id: "asc" },
      });
      if (!candidate) return null;

      const lease = new Date(now.getTime() + LEASE_SECONDS * 1000);
      const claimed = await prisma.generation_jobs.updateMany({
        where: {
          id: candidate.id,
          fencing_token: candidate.fencing_token,
          status: candidate.status,
        },
        data: {
          status: "processing",
          lease_owner: workerId,
          lease_expires_at: lease,
          last_polled_at: now,
          fencing_token: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) return null;

      return {
        id: candidate.id.toString(),
        projectId: candidate.project_id?.toString() ?? "0",
        userId: candidate.user_id.toString(),
        input:
          candidate.input &&
          typeof candidate.input === "object" &&
          !Array.isArray(candidate.input)
            ? (candidate.input as Record<string, unknown>)
            : {},
        providerTaskId: candidate.provider_task_id,
        cancelRequested: candidate.cancel_requested_at !== null,
        workerId,
        fencingToken: Number(candidate.fencing_token + 1n),
        /** IKBBXH：轮询次数（rescheduleProviderPoll 累计），供轮询上限判定。 */
        pollCount: Number(candidate.poll_count ?? 0),
        /** IKEA26：瞬时网络错误重排时保持轮询进度显示不倒退（rescheduleProviderPoll 落库用）。 */
        progress: Number(candidate.progress ?? 0),
        // IKEA26：父 job 的 provider_task_id（retry job 有 retry_of_job_id 时查）。
        // candidate 行已含 retry_of_job_id（findFirst 全行返回）——非 retry job 零额外查询；
        // 仅 retry job 多查一次父 job（1 查询），按归属 scope 防未来跨租户路径。
        parentProviderTaskId: candidate.retry_of_job_id
          ? await loadParentProviderTaskId(
              prisma,
              candidate.retry_of_job_id,
              candidate.user_id,
              candidate.project_id,
            )
          : null,
        // IK9VZ0：视频实扣二次校验的基准（预留金额，fen；无预留/查询失败为 null）。
        reservedAmountFen: await loadReservationFen(prisma, candidate.id),
      };
    },

    async claimImageJobById(jobId, workerId) {
      // IKBGKA：图片 MQ 消费端按 RocketMQ 消息 jobId 领取单个图片 job（镜像 claimVideoJobById，
      // type="image"、无 request userId——job 自带 user_id，消费端非 request-scoped 无跨用户风险）。
      const now = new Date();
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          id: BigInt(jobId),
          type: "image",
          source: { in: CLAIMABLE_JOB_SOURCES },
          is_delete: false,
          next_action_at: { lte: now },
          OR: [
            { status: "queued" },
            {
              status: "processing",
              OR: [
                { lease_expires_at: null },
                { lease_expires_at: { lt: now } },
              ],
            },
          ],
        },
        orderBy: { id: "asc" },
      });
      if (!candidate) return null;

      const lease = new Date(now.getTime() + LEASE_SECONDS * 1000);
      const claimed = await prisma.generation_jobs.updateMany({
        where: {
          id: candidate.id,
          fencing_token: candidate.fencing_token,
          status: candidate.status,
        },
        data: {
          status: "processing",
          lease_owner: workerId,
          lease_expires_at: lease,
          last_polled_at: now,
          fencing_token: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) return null;

      return {
        id: candidate.id.toString(),
        project_id: candidate.project_id?.toString() ?? "0",
        user_id: candidate.user_id.toString(),
        type: candidate.type,
        input: (candidate.input as Record<string, unknown> | null) ?? null,
        expected_output_count: candidate.expected_output_count ?? 1,
        retry_count: candidate.retry_count ?? 0,
        cancelRequested: candidate.cancel_requested_at != null,
        fencingToken: Number(candidate.fencing_token + 1n),
      };
    },

    async claimAudioJobById(jobId, workerId) {
      // IKCR78：音频 MQ 消费端按 RocketMQ 消息 jobId 领取单个音频 job（镜像 claimImageJobById，
      // type="audio"、无 request userId——job 自带 user_id，消费端非 request-scoped 无跨用户风险）。
      // 不套 source 白名单（IKC9EJ 教训对齐 media_extract）：恢复扫描 listDueAudioJobIds 同样
      // 不套白名单，两者语义对称——非白名单 source 的音频 job 不会被「recovery 补入队但 claim 拒绝」
      // 卡死成无限重放死循环。音频任务 source 当前恒为 bottom_dock，无实际新增接管面。
      const now = new Date();
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          id: BigInt(jobId),
          type: "audio",
          is_delete: false,
          next_action_at: { lte: now },
          OR: [
            { status: "queued" },
            {
              status: "processing",
              OR: [
                { lease_expires_at: null },
                { lease_expires_at: { lt: now } },
              ],
            },
          ],
        },
        orderBy: { id: "asc" },
      });
      if (!candidate) return null;

      const lease = new Date(now.getTime() + LEASE_SECONDS * 1000);
      const claimed = await prisma.generation_jobs.updateMany({
        where: {
          id: candidate.id,
          fencing_token: candidate.fencing_token,
          status: candidate.status,
        },
        data: {
          status: "processing",
          lease_owner: workerId,
          lease_expires_at: lease,
          last_polled_at: now,
          fencing_token: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) return null;

      return {
        id: candidate.id.toString(),
        project_id: candidate.project_id?.toString() ?? "0",
        user_id: candidate.user_id.toString(),
        type: candidate.type,
        input: (candidate.input as Record<string, unknown> | null) ?? null,
        expected_output_count: candidate.expected_output_count ?? 1,
        retry_count: candidate.retry_count ?? 0,
        cancelRequested: candidate.cancel_requested_at != null,
        fencingToken: Number(candidate.fencing_token + 1n),
      };
    },

    async claimMediaExtractJobById(jobId, workerId) {
      // IKARDY：媒体提取短步骤，镜像 claimVideoJobById 的 CAS 领取；type=media_extract 不限 source。
      const now = new Date();
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          id: BigInt(jobId),
          type: "media_extract",
          is_delete: false,
          next_action_at: { lte: now },
          OR: [
            { status: "queued" },
            {
              status: "processing",
              OR: [
                { lease_expires_at: null },
                { lease_expires_at: { lt: now } },
              ],
            },
          ],
        },
        orderBy: { id: "asc" },
      });
      if (!candidate) return null;

      const lease = new Date(now.getTime() + LEASE_SECONDS * 1000);
      const claimed = await prisma.generation_jobs.updateMany({
        where: {
          id: candidate.id,
          fencing_token: candidate.fencing_token,
          status: candidate.status,
        },
        data: {
          status: "processing",
          lease_owner: workerId,
          lease_expires_at: lease,
          last_polled_at: now,
          fencing_token: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) return null;

      return {
        id: candidate.id.toString(),
        projectId: candidate.project_id?.toString() ?? "0",
        userId: candidate.user_id.toString(),
        input:
          candidate.input &&
          typeof candidate.input === "object" &&
          !Array.isArray(candidate.input)
            ? (candidate.input as Record<string, unknown>)
            : {},
        workerId,
        fencingToken: Number(candidate.fencing_token + 1n),
      };
    },

    async resetStalledImageJobs() {
      const now = new Date();
      // IK7GRO：过期重放时递增 fencing_token，使上一次领取发放的旧 token 立即失效。
      // IK9ILQ：图片+音频统一重放,音频任务不进视频队列。
      // IKBGKA（review 2 轮）：图片重放后由 MQ 补入队扫描接走，本处仅做状态重置。
      const result = await prisma.generation_jobs
        .updateMany({
          where: {
            type: { in: ["image", "audio"] },
            status: "processing",
            is_delete: false,
            lease_expires_at: { lt: now },
          },
          data: {
            status: "queued",
            lease_owner: null,
            lease_expires_at: null,
            next_action_at: now,
            fencing_token: { increment: 1 },
            version: { increment: 1 },
          },
        })
        .catch(() => ({ count: 0 }));
      return result.count;
    },

    async claimNextImageJob(workerId) {
      // IK7GRQ：薄封装——认领一条到点的图片 queued，仅限 type=image，按 id asc。
      return claimQueuedJob(
        workerId,
        {
          type: "image",
          status: "queued",
          is_delete: false,
          source: { in: CLAIMABLE_JOB_SOURCES },
          next_action_at: { lte: new Date() },
        },
        { orderBy: { id: "asc" } },
      );
    },

    async claimNextInProcessJob(workerId) {
      // IK9ILQ：认领一条到点的音频 queued 任务（IKBGKA review 2 轮：图片已迁 MQ，
      // 本进程内认领仅剩音频；图片由 RecoveryService 补入队到 RocketMQ 统一处理）。
      return claimQueuedJob(
        workerId,
        {
          type: "audio",
          status: "queued",
          is_delete: false,
          source: { in: CLAIMABLE_JOB_SOURCES },
          next_action_at: { lte: new Date() },
        },
        { orderBy: { id: "asc" } },
      );
    },

    async requeueImageJobForRetry(jobId, nextActionAt) {
      // 瞬时失败重试：仅当前 processing 态可回退到 queued，避免覆盖终态/他人态。
      // IK7GRO：重排时递增 fencing_token，使上一次领取发放的旧 token 立即失效。
      const result = await prisma.generation_jobs
        .updateMany({
          where: { id: BigInt(jobId), status: "processing" },
          data: {
            status: "queued",
            lease_owner: null,
            lease_expires_at: null,
            next_action_at: nextActionAt,
            retry_count: { increment: 1 },
            fencing_token: { increment: 1 },
            version: { increment: 1 },
          },
        })
        .catch(() => ({ count: 0 }));
      return result.count > 0;
    },

    async claimNextVideoJob(workerId) {
      const now = new Date();
      const candidate = await prisma.generation_jobs.findFirst({
        where: {
          type: "video",
          source: { in: ["bottom_dock", "plan_apply", "plan", "scene_card"] },
          is_delete: false,
          next_action_at: { lte: now },
          OR: [
            { status: "queued" },
            {
              status: "processing",
              OR: [
                { lease_expires_at: null },
                { lease_expires_at: { lt: now } },
              ],
            },
          ],
        },
        orderBy: { id: "asc" },
      });
      if (!candidate) return null;

      const lease = new Date(now.getTime() + LEASE_SECONDS * 1000);
      const claimed = await prisma.generation_jobs.updateMany({
        where: {
          id: candidate.id,
          fencing_token: candidate.fencing_token,
          status: candidate.status,
        },
        data: {
          status: "processing",
          lease_owner: workerId,
          lease_expires_at: lease,
          last_polled_at: now,
          fencing_token: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) return null;

      return {
        id: candidate.id.toString(),
        projectId: candidate.project_id?.toString() ?? "0",
        userId: candidate.user_id.toString(),
        input:
          candidate.input &&
          typeof candidate.input === "object" &&
          !Array.isArray(candidate.input)
            ? (candidate.input as Record<string, unknown>)
            : {},
        providerTaskId: candidate.provider_task_id,
        cancelRequested: candidate.cancel_requested_at !== null,
        workerId,
        fencingToken: Number(candidate.fencing_token + 1n),
        /** IKBBXH：轮询次数（rescheduleProviderPoll 累计），供轮询上限判定。 */
        pollCount: Number(candidate.poll_count ?? 0),
        /** IKEA26：瞬时网络错误重排时保持轮询进度显示不倒退（rescheduleProviderPoll 落库用）。 */
        progress: Number(candidate.progress ?? 0),
        // IKEA26：父 job 的 provider_task_id（retry job 有 retry_of_job_id 时查）。
        // candidate 行已含 retry_of_job_id（findFirst 全行返回）——非 retry job 零额外查询；
        // 仅 retry job 多查一次父 job（1 查询），按归属 scope 防未来跨租户路径。
        parentProviderTaskId: candidate.retry_of_job_id
          ? await loadParentProviderTaskId(
              prisma,
              candidate.retry_of_job_id,
              candidate.user_id,
              candidate.project_id,
            )
          : null,
        // IK9VZ0：视频实扣二次校验的基准（预留金额，fen；无预留/查询失败为 null）。
        reservedAmountFen: await loadReservationFen(prisma, candidate.id),
      };
    },
  };
}

/** IKEA26：查 retry job 的父 job provider_task_id（第 3 层防双扣用）。
 *  retry job 创建时带 retry_of_job_id（generation-command-repo），父 job 上存着上次
 *  提交的上游 task id；worker claim retry job 时据此查上游旧 task 状态，SUCCESS 则
 *  复用结果不重新 submit，避免双份生成 + 双份扣费。非 retry job 不调用（调用方先判
 *  retry_of_job_id 非空）。按 user_id/project_id scope 查父 job，防未来 worker 无归属
 *  scope 的路径读到跨租户数据（retryJob 创建时已校验归属，此处自证不变式）。 */
async function loadParentProviderTaskId(
  prisma: PrismaClient,
  parentJobId: bigint,
  userId: bigint,
  projectId: bigint | null,
): Promise<string | null> {
  const parent = await prisma.generation_jobs.findFirst({
    where: { id: parentJobId, user_id: userId, project_id: projectId },
    select: { provider_task_id: true },
  });
  return parent?.provider_task_id ?? null;
}
