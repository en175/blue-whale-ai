// Seedance 2.5 样片 / 成片跨进程契约（IKIZQ5，父规格 IKIZPZ「实施决策」）。
//
// 本文件只冻结契约语义，不含运行时实现（Product API / Java Worker / 计费是后续子票）。
// 事实来源：
//   · 官方能力边界  docs/research（IKIZBQ）：Draft 480p / Final 1080p / Draft ID 自上游
//     created_at 起 7 天有效 / 两阶段独立计费 / Final 自动复用 Draft 输入且禁止重传。
//   · 网关能力（IKIZBR）：网关用公开样片任务 ID 承载 finalize，私有上游 Draft ID
//     不出网关——因此浏览器契约里**没有也不允许有**上游 Draft ID 字段。
//   · 同 ID 重试边界（IKIZPO/IKIZI7）：失败后复用同一 Draft ID 未证实，首版关闭。
//   · 截止边界（IKIZKG）：网关 SubmitTime 晚于上游 created_at，不能当 7 天起算点。
import { z } from "zod";

/** 十进制字符串 ID（BigInt 序列化后的浏览器形态；工单红线：契约 ID 一律字符串）。 */
const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);

// ═══════════════════════════════════════════════════════════════
// 一、阶段身份（两个 GenerationJob、两个 Asset）
// ═══════════════════════════════════════════════════════════════

/** 视频阶段（投影字段 `video_stage` 的值域）。
 *  - `video`：普通直接生成的视频结果（旧语义，旧任务缺该字段时按它处理）；
 *  - `sample`：样片——已提交并成功交付的 480p 结果，独立 GenerationJob + 独立 Asset；
 *  - `final`：成片——从样片显式生成的 1080p 结果，独立 GenerationJob + 独立 Asset，
 *    经 `source_sample_job_id` 指向来源样片。
 *  值名是本仓领域语言（CONTEXT.md「样片/成片」），与上游 draft/finalize 词汇无关。 */
export const VIDEO_STAGES = ["video", "sample", "final"] as const;
export const videoStageSchema = z.enum(VIDEO_STAGES);
export type VideoStage = z.infer<typeof videoStageSchema>;

/** 样片创建仅是现有视频创建契约的**参数增量**：`parameters.sample_mode = true`
 *  且分辨率锁定 480p（IKIZBQ：Draft 非 480p 上游报错）。请求仍是单输出 video、
 *  既有 references / parameters 结构；未传或 false 沿用普通视频语义。
 *  模型门控（仅 Seedance 2.5 + 放行 + 四模式）由服务端执行，不在浏览器契约表达。 */
export const SAMPLE_MODE_PARAM = "sample_mode";
export const VIDEO_SAMPLE_RESOLUTION = "480p";
export const VIDEO_FINAL_RESOLUTION = "1080p";

/** 叠加在现有创建 parameters 之上的样片增量约束（其余键沿用普通视频契约，不在此重复）。 */
export const sampleModeParametersSchema = z
  .object({
    [SAMPLE_MODE_PARAM]: z.literal(true),
    resolution: z.literal(VIDEO_SAMPLE_RESOLUTION),
  })
  .strict();
export type SampleModeParameters = z.infer<typeof sampleModeParametersSchema>;

// ═══════════════════════════════════════════════════════════════
// 二、报价版本与提交确认
// ═══════════════════════════════════════════════════════════════

/** 阶段报价视图（样片 / 成片 / 重新生成三类报价入口共用）。
 *  - `credits`：整数积分（零浮点硬约定），`null` = 算不出价格 → 该阶段**禁用提交**；
 *  - `quote_revision`：报价版本指纹（非空字符串，服务端按冻结输入 + 能力规则 +
 *    用户等级 + 目录版本生成）。提交必须原样带回；服务端复算不一致即拒
 *    （`quote_stale`）——「报价不可用或报价变动时不能按未知或未确认的金额提交」。
 *  无报价时两字段**同时**为 null，不存在「有版本无价格」。 */
export const stageQuoteViewSchema = z
  .object({
    credits: z.number().int().positive().nullable(),
    quote_revision: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.credits === null && value.quote_revision !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "无报价时 quote_revision 必须同为 null",
        path: ["quote_revision"],
      });
    }
    if (value.credits !== null && value.quote_revision === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "有报价时必须携带 quote_revision",
        path: ["quote_revision"],
      });
    }
  });
export type StageQuoteView = z.infer<typeof stageQuoteViewSchema>;

/** 提交确认字段（三类提交请求共用增量）：
 *  `expected_credits` = 报价返回的整数积分；`quote_revision` = 报价版本。
 *  服务端按同一规则复算，价格变化先刷新可见报价、再由用户点击。 */
export const confirmedSubmitFieldsSchema = z
  .object({
    expected_credits: z.number().int().positive(),
    quote_revision: z.string().min(1),
  })
  .strict();
export type ConfirmedSubmitFields = z.infer<typeof confirmedSubmitFieldsSchema>;

// ═══════════════════════════════════════════════════════════════
// 三、成片（finalize）请求 —— 浏览器只带本仓任务 ID
// ═══════════════════════════════════════════════════════════════

/** 成片报价 / 提交共用路径参数：`POST /api/projects/:projectId/generation-jobs/:jobId/finalize[/quote]`
 *  —— `jobId` 是**本仓样片任务 ID**（十进制字符串）。报价请求 body 为空对象。 */
export const videoFinalizeQuoteRequestSchema = z.object({}).strict();

/** 成片提交请求体：**只有**提交确认两字段（Idempotency-Key 走请求头）。
 *  `.strict()` 是机械防线：提示词、参考、时长、比例、音频设置、上游 Draft ID
 *  一概进不来——上游输入由服务端从样片冻结输入派生，浏览器不重放（IKIZBQ：
 *  Final 阶段重传 Draft 输入字段会被上游报错；IKIZBR：网关自行组装 draft_task）。 */
export const videoFinalizeCreateRequestSchema = confirmedSubmitFieldsSchema;
export type VideoFinalizeCreateRequest = z.infer<typeof videoFinalizeCreateRequestSchema>;

/** 同一用户意图至多一条已发往上游的成片尝试：数据库对来源样片任务 ID 的
 *  **原子唯一约束**（后续 schema 子票落地，本契约先冻结语义）。同键重放、双击、
 *  两页并发至多产生一条成片任务与一笔预扣；命中已有尝试回
 *  `finalize_already_attempted`。首版不复用同一 Draft ID 成片重试（IKIZPO：
 *  失败后同 ID 重试未证实）——「重新生成样片」走新样片任务，不重发 finalize。 */
export const FINALIZE_SOURCE_UNIQUE_KEY = "source_sample_job_id";

// ═══════════════════════════════════════════════════════════════
// 四、可信截止时间（finalize_deadline_at）
// ═══════════════════════════════════════════════════════════════

/** 官方窗口：Draft ID 自**上游 Draft created_at** 起 7 天有效（IKIZBQ）。
 *  起算点是网关提供的可信上游创建时间——不能以网关 SubmitTime 或本地建行时间
 *  替代（IKIZKG：SubmitTime 晚于 created_at，会把已过期的当有效放行）。 */
export const FINALIZE_WINDOW_DAYS = 7;

/** 安全余量：截止 = 可信 created_at + 7 天 − 余量。首版取 1 小时（保守值），
 *  上线前按 IKIZKG 临界受理实测校准；本仓与网关按**同一值**拒绝临界或过期请求。
 *  ponytail: 物理边界留校准旋钮，实测后只改这一个常量。 */
export const FINALIZE_SAFETY_MARGIN_MS = 60 * 60 * 1000;

/** 缺可信 created_at 时的语义：样片保留（预览、下载不受影响），但
 *  `finalize_deadline_at = null` → 服务端禁用成片提交。不猜测、不用替代时间。 */

/** 由可信上游 Draft created_at（epoch 毫秒）推实际截止时间（RFC3339 带时区字符串）。
 *  TS / Java 实现按同一公式对账（金标用例 G06）。 */
export function finalizeDeadlineFromUpstreamCreatedAt(
  upstreamCreatedAtMs: number,
): string {
  return new Date(
    upstreamCreatedAtMs + FINALIZE_WINDOW_DAYS * 24 * 60 * 60 * 1000 - FINALIZE_SAFETY_MARGIN_MS,
  ).toISOString();
}

// ═══════════════════════════════════════════════════════════════
// 五、重新生成样片（新任务、新卡，不继承旧状态）
// ═══════════════════════════════════════════════════════════════

/** 重新生成样片请求体（`POST .../generation-jobs/:jobId/regenerate-sample`，
 *  `jobId` = 原样片任务 ID）：从原样片**冻结输入**新建任务与结果卡，重新校验
 *  素材与现价（提交确认两字段必带，报价独立入口返回）。不继承旧报价、旧截止、
 *  旧 Draft ID——新样片有自己的上游任务与期限。 */
export const sampleRegenerateRequestSchema = confirmedSubmitFieldsSchema;
export type SampleRegenerateRequest = z.infer<typeof sampleRegenerateRequestSchema>;

// ═══════════════════════════════════════════════════════════════
// 六、阶段费用与核对状态
// ═══════════════════════════════════════════════════════════════

/** 阶段费用状态（投影字段 `charge_state` 的值域）——按**阶段**独立执行：
 *  - `held`：已预扣（Hold），生成中；
 *  - `settled`：已按真实用量结算（Settle，依据冻结规则快照 + Worker 上报用量）；
 *  - `released`：该阶段失败，预扣已释放（Release）。
 *  一张样片确认失败退回**该阶段**冻结积分，另一已成功阶段的费用保持不变。
 *  网关 quota 仅用于对账，不充当用户积分。旧任务 / 非两阶段任务为 null。 */
export const CHARGE_STATES = ["held", "settled", "released"] as const;
export const chargeStateSchema = z.enum(CHARGE_STATES);
export type ChargeState = z.infer<typeof chargeStateSchema>;

/** 提交结果不明时任务的锁定状态值（generation_jobs.status 的新增字符串值）：
 *  Worker 调网关前持久标记提交中；调用超时、响应丢失、落库失败或失租时进入
 *  `checking`——**不**按空 provider_task_id 重新提交、**不**自动退款，先核对本仓、
 *  网关、上游与账单：明确成功恢复原任务，明确失败释放该阶段预扣，仍不明保持
 *  锁定交人工。期间再次提交被拒（错误码 `submission_unknown`，1014）。
 *  仅本地前置校验且未发往网关的错误**不**进入该状态、不占上游尝试。 */
export const JOB_STATUS_CHECKING = "checking";

// ═══════════════════════════════════════════════════════════════
// 七、浏览器投影（任务详情 / 列表、资产列表 / 详情）
// ═══════════════════════════════════════════════════════════════

/** 两阶段视频任务的浏览器投影增量（父规格「投影与兼容」节点名的全部字段）。
 *  叠加在现有 JobStatusView / JobListItem 之上；旧任务、旧画布文档、普通 480p 和
 *  其他模型缺阶段字段时按普通视频处理（video_stage 缺省 video、来源与费用为 null）。
 *  时间为 RFC3339 带时区字符串（contracts 三条硬约定之一）。 */
export const videoStageJobProjectionSchema = z
  .object({
    video_stage: videoStageSchema,
    /** 成片任务指向来源样片任务（仅 final 阶段非 null）。 */
    source_sample_job_id: decimalIdSchema.nullable(),
    /** 样片任务指向其唯一成片任务（首版一张样片至多一条成片；仅 sample 阶段可非 null）。 */
    final_job_id: decimalIdSchema.nullable(),
    /** 样片的实际转成片截止时间；null = 缺可信上游 created_at（禁用成片，样片仍保留）。 */
    finalize_deadline_at: z.string().nullable(),
    charge_state: chargeStateSchema.nullable(),
    actual_credits: z.number().int().nullable(),
  })
  .strict();
export type VideoStageJobProjection = z.infer<typeof videoStageJobProjectionSchema>;

/** 两阶段视频资产的投影增量（资产列表 / 详情的「阶段与来源身份」）：
 *  阶段 + 与来源任务的互指；素材留存与转成片资格分离——样片到期不自动删除。 */
export const videoStageAssetProjectionSchema = z
  .object({
    video_stage: videoStageSchema,
    source_sample_job_id: decimalIdSchema.nullable(),
    final_job_id: decimalIdSchema.nullable(),
  })
  .strict();
export type VideoStageAssetProjection = z.infer<typeof videoStageAssetProjectionSchema>;
