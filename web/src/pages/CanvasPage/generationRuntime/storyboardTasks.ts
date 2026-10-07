/* ============================================
 * 成片与重生样片任务类型定义（IKJJR6，IKIXK9-SPEC-20261002 A.5）：
 *  - 成片（finalize）：样片卡标题行入口；服务端从样片冻结输入派生 1080p 任务，
 *    请求体仅报价确认两字段（契约 videoFinalizeCreateRequestSchema .strict()——
 *    不收 canvas_binding），成片任务无受理关联，按历史兼容路径追踪与水合恢复。
 *  - 重生样片（regenerate-sample）：成片失败卡失败区「重试」入口；服务端从原样片
 *    冻结输入新建样片任务与新承接目标（不覆盖旧成片卡/费用记录），canvas_binding
 *    随确认字段提交（契约 sampleRegenerateRequestSchema），新样片卡获得恢复保障。
 * 卡片后续生命周期（轮询/终态/失败重试/取消/删除/水合/恢复对账）不归本定义承接：
 * 两阶段卡就是 video 任务，由 normalGeneration 统一认领（先注册先分派）。
 * ============================================ */
import {
  finalizeVideoJob, regenerateSampleJob,
} from '@/api/jobs';
import type { CreateJobOutcome, GenerationTaskDefinition, TaskSubmissionInput } from './types';

/** 两入口共用的提交意图载荷（页面按报价确认组好；输入由服务端从原样片派生）。 */
export interface StoryboardPayload {
  kind: 'finalize' | 'regenerate-sample';
  /** 本仓原样片任务 ID（finalize 的受理来源；regenerate 的派生来源）。 */
  sampleJobId: string;
  /** 报价确认两字段（契约 confirmedSubmitFields）：面板已按报价就绪门控。 */
  expectedCredits: number;
  quoteRevision: string;
  /** 受理成功提示（页面闭包：成功 toast + 受理后立即落盘）。不参与幂等签名——
   *  JSON.stringify 丢弃函数字段；不进请求体（端点契约 .strict()）。 */
  onAccepted?: (jobId: string) => void;
}

export type StoryboardTaskDefinition = GenerationTaskDefinition<StoryboardPayload>;

/** 成片/重生样片任务类型定义（提交差异承载；见文件头注释）。 */
export const storyboardTask: StoryboardTaskDefinition = {
  // 成片无受理关联（端点契约不收 canvas_binding → 无 generation_canvas_submissions
  // 记录）；重生样片任务 task_type='video'，恢复记录由 normalGeneration（先注册）
  // 按普通 video 记录对账——补卡/续轮询/输出投影对两者形态一致。
  taskTypes: [],

  // 卡片生命周期不归本定义：两阶段卡（videoStage=sample/final）由 normalGeneration
  // 统一认领（轮询/通用失败重试/取消/删除与水合恢复同普通 video 任务）。
  identify: () => false,

  // 冻结输入在服务端：finalize/regenerate 端点从原样片冻结输入派生（客户端不重传）。
  // 入口侧缺输入阻断（sourceSampleJobId 缺失无入口）由页面渲染门控表达。

  async create(projectId, input: TaskSubmissionInput<StoryboardPayload>, binding, key): Promise<CreateJobOutcome> {
    const payload = input.payload;
    const confirmed = { expected_credits: payload.expectedCredits, quote_revision: payload.quoteRevision };
    if (payload.kind === 'finalize') {
      // 成片端点契约 .strict() 不收 canvas_binding（服务端从样片冻结输入派生）——binding
      // 弃用；受理响应无回执视图，按历史兼容任务追踪（水合 jobId 续轮询，无恢复记录）。
      const created = await finalizeVideoJob(projectId, payload.sampleJobId, confirmed, key, { silent: true });
      const outcome: CreateJobOutcome = { jobId: created.generation_job_id, cursor: created.cursor, canvasBinding: null };
      payload.onAccepted?.(outcome.jobId);
      return outcome;
    }
    // 重生样片：canvas_binding 随确认字段提交（新样片独立承接目标），成功 data 追加回执视图。
    const created = await regenerateSampleJob(
      projectId,
      payload.sampleJobId,
      binding ? { ...confirmed, canvas_binding: binding } : confirmed,
      key,
      { silent: true },
    );
    const outcome: CreateJobOutcome = {
      jobId: created.generation_job_id,
      cursor: created.cursor,
      canvasBinding: (created as { canvas_binding?: CreateJobOutcome['canvasBinding'] }).canvas_binding ?? null,
    };
    payload.onAccepted?.(outcome.jobId);
    return outcome;
  },
};
