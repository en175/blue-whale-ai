import { Injectable } from "@nestjs/common";
import {
  RESOURCE_NOT_FOUND_CODE,
  VIDEO_SCENE_SPLIT_RESULT_KEYS,
  errorCodeToNumeric,
  fail,
  ok,
  videoSceneSplitResultSchema,
  type PublicGenerationError,
} from "@lib/contracts";
import {
  createJobRepo,
  type AdminJobListItem,
  type AdminJobListFilter,
} from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
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

/** 管理端任务记录的一行：与仓库层相比，把 `stored_error` 换成了投影后的 `error`。 */
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

  /**
   * 管理端任务列表（全站，offset 分页）。
   *
   * <p>与 {@link list} 的差别只有「谁的」：那条按登录用户过滤（用户只看自己的），
   * 这条可以不过滤（管理端要看全站）或指定某个用户。投影口径一致——
   * 失败原因用的是**同一份** {@link projectPublicError}，所以管理端看到的文案
   * 与用户申诉时看到的是同一句，不必再去猜「他说的那个报错是哪个码」。
   *
   * <p>⚠️ 不做归属校验（那是 user 面的 `getStatus` 才需要的）：能进这个方法的调用者
   *    已经过了 `AdminGuard`。
   */
  async listForAdmin(filter: AdminJobListFilter): Promise<AdminJobListResult> {
    const page = await this.repo.listForAdmin(filter);
    return {
      ...page,
      records: page.records.map(({ stored_error: storedError, ...record }) => ({
        ...record,
        // 与 listByUser 同一个投影器：管理端与用户端看到的是同一句话
        error: projectPublicError(storedError ?? null, record.type),
      })),
    };
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
      // 一对多产物（IKH8C1 场景切分扇出）：全部产出资源 + 契约 result。result 从终态日志
      // payload 按契约键挑子集再过 strict schema（payload 另带 asset_ids 等入库字段，不外发），
      // 校验不过即 null，不向下游投影畸形日志。
      output_assets: job.output_assets,
      result: (() => {
        if (job.result === null) return null;
        const duration = job.result[VIDEO_SCENE_SPLIT_RESULT_KEYS.duration];
        const segments = job.result[VIDEO_SCENE_SPLIT_RESULT_KEYS.segments];
        const parsed = videoSceneSplitResultSchema.safeParse({ duration, segments });
        return parsed.success ? parsed.data : null;
      })(),
      // IKFM3S §4：签名投影随详情返回（仅成功路径消费；input 其余字段不下发）。
      text_input_signature: job.text_input_signature,
      // IKHA2J：vocal_split 多轨结果（契约 VocalSplitTrackResult：track_type / asset_id /
      // url / duration，轨序 = 契约 SCENE_TRACKS[scene]）；其他任务类型恒 null，asset 单对象
      // 投影不动（既有单 asset 消费者不受影响）。
      tracks: job.tracks,
    });
  }
}
