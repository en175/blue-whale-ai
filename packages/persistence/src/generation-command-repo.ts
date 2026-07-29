import type { PrismaClient } from "@prisma/client";

/** 生成命令 repo（Prisma-backed）：创建/取消/重试生成任务 + 操作日志 + 点数预留。
 *  简化模型：一次任务一行（单输出语义，产出写 output_asset_ids JSON 数组）。
 *  对齐本仓 Java GenerationJobCommandService 的字段与状态语义，但不做多槽/幂等表。 */

export interface CreateJobInput {
  projectId: string;
  userId: string;
  type: "image" | "video";
  expectedOutputCount: number;
  input: Record<string, unknown>;
  actionIdentity: string;
  actionType: string;
}

export interface CreatedJob {
  generation_job_id: string;
  cursor: number;
}

export interface GenerationCommandRepo {
  createJob(input: CreateJobInput): Promise<CreatedJob>;
  /** 软取消：置 cancel_requested_at，状态不变（worker 读到后停止）。返回是否命中可取消的任务。 */
  requestCancel(jobId: string, userId: string): Promise<boolean>;
  /** 重试缺失产出：复制原 job 入参，建新 job（retry_of_job_id 指向原 job），状态 queued。 */
  retryJob(originalJobId: string, userId: string, idempotencyKey: string): Promise<CreatedJob | null>;
  appendLog(jobId: string, event: string, status: string | null, message?: string, payload?: unknown): Promise<void>;
}

const SOURCE_BOTTOM_DOCK = "bottom_dock";

export function createGenerationCommandRepo(prisma: PrismaClient): GenerationCommandRepo {
  return {
    async createJob(input) {
      const now = new Date();
      const deadline = new Date(now.getTime() + 30 * 60 * 1000); // 30min 超时
      const job = await prisma.generation_jobs.create({
        data: {
          project_id: BigInt(input.projectId),
          user_id: BigInt(input.userId),
          type: input.type,
          source: SOURCE_BOTTOM_DOCK,
          status: "queued",
          progress: 0,
          input: input.input as never,
          expected_output_count: input.expectedOutputCount,
          action_identity: input.actionIdentity,
          project_action_identity: input.actionIdentity,
          strategy_version: input.type === "video" ? "seedance-2.0-v1" : "image-sync-v1",
          execution_deadline_at: deadline,
          next_action_at: now,
          fencing_token: 0,
        },
      });
      const jobId = job.id.toString();

      // 点数预留（pass-through：暂无计价引擎，reserved=0，worker 完成后由结算逻辑写 actual）。
      await prisma.cost_reservations.create({
        data: {
          generation_job_id: job.id,
          user_id: BigInt(input.userId),
          project_id: BigInt(input.projectId),
          action_identity: input.actionIdentity,
          action_type: input.actionType,
          provider: "volc",
          reserved_amount_fen: 0,
          status: "reserved",
          price_catalog_version: "dev",
          exchange_rate_version: "dev",
          model_policy_version: "dev",
          cost_rule_version: "dev",
        },
      });

      await this.appendLog(jobId, "created", "queued", "任务已创建", { input });

      return { generation_job_id: jobId, cursor: 0 };
    },

    async requestCancel(jobId, userId) {
      // 仅归属当前用户的 queued/processing 任务可取消。
      const job = await prisma.generation_jobs.findFirst({
        where: { id: BigInt(jobId), user_id: BigInt(userId), is_delete: false },
        select: { id: true, status: true },
      });
      if (!job || (job.status !== "queued" && job.status !== "processing")) return false;
      await prisma.generation_jobs.update({
        where: { id: BigInt(jobId) },
        data: { cancel_requested_at: new Date() },
      });
      await this.appendLog(jobId, "cancel_requested", job.status, "用户请求取消");
      return true;
    },

    async retryJob(originalJobId, userId) {
      const original = await prisma.generation_jobs.findFirst({
        where: { id: BigInt(originalJobId), user_id: BigInt(userId), is_delete: false },
      });
      if (!original) return null;
      if (original.status !== "failed" && original.status !== "partially_succeeded") return null;

      const now = new Date();
      const deadline = new Date(now.getTime() + 30 * 60 * 1000);
      const retry = await prisma.generation_jobs.create({
        data: {
          project_id: original.project_id ?? BigInt(0),
          user_id: original.user_id,
          type: original.type,
          source: original.source,
          status: "queued",
          progress: 0,
          input: original.input as never,
          expected_output_count: original.expected_output_count ?? 1,
          retry_of_job_id: original.id,
          action_identity: `retry:${originalJobId}`,
          project_action_identity: `retry:${originalJobId}`,
          strategy_version: original.strategy_version ?? (original.type === "video" ? "seedance-2.0-v1" : "image-sync-v1"),
          execution_deadline_at: deadline,
          next_action_at: now,
          fencing_token: 0,
        },
      });
      const retryId = retry.id.toString();
      await this.appendLog(retryId, "retry_created", "queued", `重试 ${originalJobId}`);
      return { generation_job_id: retryId, cursor: 0 };
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
  };
}
