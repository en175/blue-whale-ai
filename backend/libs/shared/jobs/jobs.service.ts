import { Injectable, Logger } from "@nestjs/common";
import {
  RESOURCE_NOT_FOUND_CODE,
  VIDEO_SCENE_SPLIT_RESULT_KEYS,
  errorCodeToNumeric,
  errorRecoveryOf,
  fail,
  ok,
  videoSceneSplitResultSchema,
  type PublicGenerationError,
} from "@lib/contracts";
import {
  createJobRepo,
  type AdminJobListItem,
  type AdminJobListFilter,
  type ChargeTaskSummary,
  type UserJobIdFilter,
  type UserJobIdResult,
} from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { sharedBillingClient } from "@lib/shared/billing/billing-client.js";
import { fallbackErrorCode, messageFor, projectPublicError } from "./generation-job-error-projection.js";

const MAX_BATCH_IDS = 100;
const VALID_ID = /^[1-9]\d*$/;

export interface ListJobsQuery {
  type?: string | undefined;
  status?: string | undefined;
  projectId?: string | undefined;
  ids?: string[] | undefined;
  page: number;
  size: number;
}

export type AdminJobRecord = Omit<AdminJobListItem, "stored_error"> & {
  error: PublicGenerationError | null;
};

export interface AdminJobListResult {
  records: AdminJobRecord[];
  total: number;
  size: number;
  current: number;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private repoInstance?: ReturnType<typeof createJobRepo>;

  private get repo(): ReturnType<typeof createJobRepo> {
    if (!this.repoInstance) {
      this.repoInstance = createJobRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
  ) {}

  async list(userId: string, query: ListJobsQuery) {
    const ids = query.ids;
    if (ids !== undefined) {
      const uniqueIds = [...new Set(ids)];
      if (
        uniqueIds.length === 0 ||
        uniqueIds.length > MAX_BATCH_IDS ||
        uniqueIds.some((id) => !VALID_ID.test(id))
      ) {
        return fail(
          400,
          uniqueIds.length > MAX_BATCH_IDS ? "最多查询 100 个任务" : "ids 参数无效",
        );
      }
    }
    const filter: {
      type?: string;
      status?: string;
      projectId?: string;
      ids?: string[];
      page: number;
      size: number;
    } = { page: query.page, size: query.size };
    if (query.type !== undefined) filter.type = query.type;
    if (query.status !== undefined) filter.status = query.status;
    if (query.projectId !== undefined) filter.projectId = query.projectId;
    if (query.ids !== undefined) filter.ids = [...new Set(query.ids)];
    const page = await this.repo.listByUser(userId, filter);
    await this.resolveCancelledChargeStates(userId, page.records);
    return ok({
      ...page,
      records: page.records.map(({ stored_error: storedError, ...record }) => ({
        ...record,
        error: projectPublicError(storedError ?? null, record.type),
      })),
    });
  }

  async listForAdmin(filter: AdminJobListFilter): Promise<AdminJobListResult> {
    const page = await this.repo.listForAdmin(filter);
    return {
      ...page,
      records: page.records.map(({ stored_error: storedError, ...record }) => ({
        ...record,
        error: projectPublicError(storedError ?? null, record.type),
      })),
    };
  }

  async loadTaskSummaries(
    jobIds: readonly string[],
  ): Promise<Map<string, ChargeTaskSummary>> {
    const ids = [...new Set(jobIds)].filter((id) => VALID_ID.test(id));
    if (ids.length === 0) return new Map();
    return this.repo.loadChargeTaskSummaries(ids);
  }

  async listJobIds(filter: UserJobIdFilter): Promise<UserJobIdResult> {
    return this.repo.listUserJobIds(filter);
  }

  async getStatus(userId: string, jobId: string) {
    const job = await this.repo.findByIdForUser(jobId, userId);
    if (!job) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    const owned = await this.project.findOwnedById(job.project_id, userId);
    if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    await this.resolveCancelledChargeStates(userId, [job]);

    if (job.status === "failed") {
      const projected = projectPublicError(job.stored_error, job.type);
      const fallback = fallbackErrorCode(job.type);
      const code = projected?.code ?? errorCodeToNumeric(fallback);
      const msg = projected?.message ?? messageFor(fallback, job.type);
      const recovery = errorRecoveryOf(code);
      return fail(code, msg, {
        code: projected?.reason ?? fallback,
        job_id: job.job_id,
        status: job.status,
        progress: job.progress,
        asset: job.asset,
        video_stage: job.video_stage,
        source_sample_job_id: job.source_sample_job_id,
        final_job_id: job.final_job_id,
        finalize_deadline_at: job.finalize_deadline_at,
        charge_state: job.charge_state,
        actual_credits: job.actual_credits,
        category: projected?.category ?? recovery.category,
        retryable: projected?.retryable ?? recovery.retryable,
      });
    }

    return ok({
      job_id: job.job_id,
      status: job.status,
      progress: job.progress,
      asset: job.asset,
      output_assets: job.output_assets,
      result: (() => {
        if (job.result === null) return null;
        const duration = job.result[VIDEO_SCENE_SPLIT_RESULT_KEYS.duration];
        const segments = job.result[VIDEO_SCENE_SPLIT_RESULT_KEYS.segments];
        const parsed = videoSceneSplitResultSchema.safeParse({ duration, segments });
        return parsed.success ? parsed.data : null;
      })(),
      text_input_signature: job.text_input_signature,
      tracks: job.tracks,
      video_stage: job.video_stage,
      source_sample_job_id: job.source_sample_job_id,
      final_job_id: job.final_job_id,
      finalize_deadline_at: job.finalize_deadline_at,
      charge_state: job.charge_state,
      actual_credits: job.actual_credits,
    });
  }

  private async resolveCancelledChargeStates(userId: string, records: {
    job_id: string; type: string; status: string; video_stage: string; charge_state: string | null;
  }[]): Promise<void> {
    const jobs = records.filter((job) => job.type === "video" && job.status === "cancelled" &&
      (job.video_stage === "sample" || job.video_stage === "final"));
    for (const job of jobs) job.charge_state = null;
    for (let offset = 0; offset < jobs.length; offset += MAX_BATCH_IDS) {
      const batch = jobs.slice(offset, offset + MAX_BATCH_IDS);
      try {
        const page = await sharedBillingClient().listTransactions({
          userId: Number(userId), typeFilters: ["consume"],
          generationJobIds: batch.map((job) => job.job_id), page: 1, pageSize: batch.length,
        }, { timeoutMs: 1_000 });
        for (const job of batch) {
          const state = page.items.find((item) => item.type === "consume" && item.generationJobId === job.job_id)?.chargeState;
          if (state === "charged" || state === "refunded") job.charge_state = state;
        }
      } catch {
        this.logger.warn("取消任务计费状态查询失败，本次返回未确认状态");
      }
    }
  }
}
