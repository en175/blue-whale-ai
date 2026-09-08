import { Injectable } from "@nestjs/common";
import {
  errorCodeToNumeric,
  fail,
  ok,
} from "@blue-whale/contracts";
import { createJobRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { fallbackErrorCode } from "./error-codes.js";
import { messageFor, projectPublicError } from "./public-error.js";

const RESOURCE_NOT_FOUND_CODE = 100301;
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

@Injectable()
export class JobsService {
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
    return ok({
      ...page,
      records: page.records.map(({ stored_error: storedError, ...record }) => ({
        ...record,
        error: projectPublicError(storedError ?? null, record.type),
      })),
    });
  }

  async getStatus(userId: string, jobId: string) {
    const job = await this.repo.findByIdForUser(jobId, userId);
    if (!job) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    const owned = await this.project.findOwnedById(job.project_id, userId);
    if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    // ADR-0078 二期：失败响应结构 —— { code: 数值码, msg: 中文, data: 纯任务字段 }。
    // 成功保持 code=200；失败不再用 data.error 子对象，错误码提升到顶层。
    if (job.status === "failed") {
      const projected = projectPublicError(job.stored_error, job.type);
      // stored_error 为 null（历史数据/非对象 error）时 code 与 msg 同步走类型兜底，
      // 避免 code=1000 与 msg 类型文案脱节。
      const fallback = fallbackErrorCode(job.type);
      const code = projected?.code ?? errorCodeToNumeric(fallback);
      const msg = projected?.message ?? messageFor(fallback, job.type);
      return fail(code, msg, {
        job_id: job.job_id,
        status: job.status,
        progress: job.progress,
        asset: job.asset,
      });
    }

    return ok({
      job_id: job.job_id,
      status: job.status,
      progress: job.progress,
      asset: job.asset,
    });
  }
}
