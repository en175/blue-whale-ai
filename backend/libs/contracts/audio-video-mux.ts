import { z } from "zod";
import { canvasBindingSchema } from "./canvas-recovery.js";

/** IKIHPJ（父规格 IKIHMX）: 业务 API、持久化快照与 Worker 共用的音视频合成字段（迁移契约 §21）。
 * 冻结快照对象内用 `assetId`/`nodeId`（camel，规格 JSON 字面），顶层 `is_audio_reserve`/`sync`；
 * 网关出站键另按供应商 snake_case（video_url/audio_url/...），两套命名不混。 */
export const AUDIO_VIDEO_MUX_JOB_TYPE = "audio_video_mux";
export const AUDIO_VIDEO_MUX_SOURCE = "dock";
export const AUDIO_VIDEO_MUX_SUBMIT_PATH = "/v1/mediakit/mux-audio-video";
export const AUDIO_VIDEO_MUX_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";
export const AUDIO_VIDEO_MUX_MODEL = "mediakit-mux-audio-video";
export const AUDIO_VIDEO_MUX_SYNC_MODES = ["none", "video", "audio"] as const;

/** 结果资产命名后缀（迁移契约 §21.4）：源视频资产名去扩展名 + 本后缀；worker-java
 *  JobFinalizer.composeAudioVideoMuxResultName 持同一字面（Java 无法 import TS，靠
 *  audio-video-mux.test.ts 读 Java 源逐值对账钉死两侧一致，前端回填取资产名同源）。 */
export const AUDIO_VIDEO_MUX_RESULT_NAME_SUFFIX = "(音视频合成).mp4";

/** 供应商 client_token 前缀（幂等键 = 前缀 + jobId + "-" + 提交尝试序号；≤64 可打印 ASCII）。 */
export const AUDIO_VIDEO_MUX_CLIENT_TOKEN_PREFIX = "bwmux-";

/** 供应商层幂等键：jobId + 提交尝试序号确定性派生；崩溃重提同 token 被供应商去重，
 * 业务重试递增 submit_attempt 换新 token 不被去重（与 command_idempotency 业务层双轨并存）。 */
export function audioVideoMuxClientToken(jobId: string, submitAttempt: number): string {
  return `${AUDIO_VIDEO_MUX_CLIENT_TOKEN_PREFIX}${jobId}-${submitAttempt}`;
}

const muxIdentitySchema = z.object({
  assetId: z.string().regex(/^[1-9][0-9]*$/),
  nodeId: z.string().min(1).optional(),
}).strict();

export const audioVideoMuxCreateSchema = z.object({
  /** 固定音频源（画布音频成品卡，必有 nodeId）。 */
  audio: z.object({
    assetId: z.string().regex(/^[1-9][0-9]*$/),
    nodeId: z.string().min(1),
  }).strict(),
  /** 单个视频输入：画布拖线绑定有 nodeId，素材库输入没有。 */
  video: muxIdentitySchema,
  /** 原声处理：true=保留原声混音（默认），false=替换原声；冻结与出站均显式传。 */
  is_audio_reserve: z.boolean().default(true),
  /** 时长对齐单字段：none=保持原长，video=裁到视频长，audio=裁到音频长；全为裁剪语义。 */
  sync: z.enum(AUDIO_VIDEO_MUX_SYNC_MODES).default("none"),
  // IKJJQZ（IKIXK9-SPEC-20261002 B.3）：恢复契约 v1 绑定（可选；未携带走历史路径零变化）。
  // 冻结进 job.input 的字段不含它——请求摘要（JSON.stringify(parsed)）自动覆盖。
  canvas_binding: canvasBindingSchema.optional(),
}).strict();

export type AudioVideoMuxCreate = z.infer<typeof audioVideoMuxCreateSchema>;
