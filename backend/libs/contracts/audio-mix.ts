import { z } from "zod";

/** IKI68N: 业务 API、持久化快照与 Worker 共用的音频混合字段。 */
export const AUDIO_MIX_JOB_TYPE = "audio_mix";
export const AUDIO_MIX_SOURCE = "dock";
export const AUDIO_MIX_OUTPUT_FORMATS = ["mp3", "m4a", "ogg", "flac", "wav"] as const;
export const AUDIO_MIX_DEFAULT_OUTPUT_FORMAT = "mp3";
export const AUDIO_MIX_SUBMIT_PATH = "/v1/mediakit/mix-audio";
export const AUDIO_MIX_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

const inputIdentitySchema = z.object({
  asset_id: z.string().regex(/^[1-9][0-9]*$/),
  node_id: z.string().min(1).optional(),
}).strict();

export const audioMixCreateSchema = z.object({
  source_node_id: z.string().min(1),
  inputs: z.array(inputIdentitySchema).min(2).max(100),
  output_format: z.enum(AUDIO_MIX_OUTPUT_FORMATS).default(AUDIO_MIX_DEFAULT_OUTPUT_FORMAT),
}).strict().superRefine((value, context) => {
  if (value.inputs[0]?.node_id !== value.source_node_id) {
    context.addIssue({ code: "custom", path: ["inputs", 0, "node_id"], message: "固定源必须是首项画布音频卡" });
  }
  if (new Set(value.inputs.map((input) => input.asset_id)).size !== value.inputs.length) {
    context.addIssue({ code: "custom", path: ["inputs"], message: "音频资产不能重复" });
  }
});

export type AudioMixCreate = z.infer<typeof audioMixCreateSchema>;

/**
 * 任务失败 error.details 的上游 HTTP 状态键（IKIHGQ）：上游非 2xx 时 worker 写入，
 * backend 重试换凭证判定读它（401 = 当前凭证失效，重试替换为请求头带来的新凭证）；
 * 既有 message 文案正则仅作旧任务数据兼容。与 worker-java AudioMixContract 对齐。
 */
export const AUDIO_MIX_ERROR_DETAIL_HTTP_STATUS = "http_status";
