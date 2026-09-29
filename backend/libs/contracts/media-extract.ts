import { z } from "zod";

/* 音视频分离（media_extract，原「提取音频」）跨进程任务契约（IKH28T）：
   权威章节 = docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md §18（冻结增量）；
   原始设计 = docs/specs/2026-08-25-ikardy-media-extract-design.md；术语见根 GLOSSARY.md。
   接口契约唯一权威 = 火山引擎 AI MediaKit「提交音频提取任务 API」官方 PDF
   POST https://mediakit.cn-beijing.volces.com/api/v1/tools/extract-audio（**异步任务**：
   提交返 task_id，轮询查询取 result.audio_url / result.duration——本仓经 new-api 网关调用；
   参数名以官方 PDF 为准，出处逐条标注在常量注释，禁止引用二手信息）。
   任务类型沿用 media_extract、input 字段结构不变是既定决策（ADR-0103：本地 ffmpeg 链路
   代码全保留，双执行路径并存），本契约只扩 output_format 枚举面与火山执行路径错误码面——
   跨进程字段在本文件定死后双端实现（红线：契约先行）：worker-java 侧同名常量类
   MediaExtractContract（domain/entity），防漂移断言见 media-extract.test.ts。
   执行路径切换（worker 处理器改造）由 IKH28W 承载、创建入口行为切换由 IKH28V 承载。 */

/** 任务类型值：generation_jobs.type 与 RocketMQ tag 同值（沿用既有 tag=type 口径，
 *  值不变——ADR-0103 不新建任务类型）；backend 入队用 queue.constants.ts 的
 *  MEDIA_EXTRACT_TAG（与本常量恒等）。 */
export const MEDIA_EXTRACT_JOB_TYPE = "media_extract";

/** 任务来源值：沿用既有唯一创建入口（画布视频卡工具条「提取音频/音视频分离」）的
 *  既有落库值 dock——media_extract 不套 claim source 白名单（契约 §2/§7），值不变。 */
export const MEDIA_EXTRACT_SOURCE = "dock";

/** input 冻结键名（两键恒在、值恒为合法枚举，创建时定死，重试原样沿用——结构不变 ADR-0103）。 */
export const MEDIA_EXTRACT_INPUT_KEYS = {
  /** 源素材身份（被分离音轨的视频 Asset id）。 */
  sourceAssetId: "source_asset_id",
  /** 输出音频格式（见 MEDIA_EXTRACT_OUTPUT_FORMATS；出站映射官方 format 参数，同名同值）。 */
  outputFormat: "output_format",
} as const;

/** 输出音频格式枚举（文档出处：官方 PDF Body 参数 format 节——「支持 mp3、m4a、ogg、
 *  flac、wav」，与火山 API 参数取值同名同值，出站原样透传）。
 *  本仓产品语义键名 output_format（input 冻结键），出站换算官方 format（IKH28W 客户端落）。 */
export const MEDIA_EXTRACT_OUTPUT_FORMATS = ["m4a", "mp3", "ogg", "flac", "wav"] as const;
export type MediaExtractOutputFormat = (typeof MEDIA_EXTRACT_OUTPUT_FORMATS)[number];

/** 缺省输出格式 m4a（文档出处：官方 PDF format 节描述文字「默认值为 m4a」——**表格示例值列
 *  写 mp3，以描述文字为准**，契约测试断言 m4a）。创建入口未传 output_format 时落本值；
 *  传了非法值（枚举外 / 非字符串 / null）明确拒绝，不再静默回退（回退口径随本契约废除）。 */
export const MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT: MediaExtractOutputFormat = "m4a";

/** 网关异步提交路由（对客）：POST {MEDIA_EXTRACT_SUBMIT_PATH}，网关按路径末段决定工具。
 *  火山上游侧对应官方 PDF「1. 提交音频提取任务 API」节逐字
 *  POST /api/v1/tools/extract-audio，由网关内部转发，本仓不直连上游。
 *  ⚠️ 网关路径 ≠ 火山上游路径（IKH67T 实测：混用即 404 Invalid URL，任务卡在提交相）。 */
export const MEDIA_EXTRACT_SUBMIT_PATH = "/v1/mediakit/extract-audio";

/** 网关异步任务查询路由前缀（拼 taskId）：GET {前缀}{task_id}。三个 MediaKit 异步工具
 *  （去字幕 / 视频 HD / 音视频分离）共用同一条查询路由，路径**不含 async 段**。 */
export const MEDIA_EXTRACT_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

/** input 冻结结构（创建入口复核与重试沿用都用本 schema；strict 防多余键）。
 *  注意：这是**冻结后**形态（output_format 已填默认值、两键恒在）；创建请求体里
 *  output_format 可选（缺省补 MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT 后再过本 schema），
 *  非法值在创建入口明确拒绝（IKH28V 权威复核，worker 侧解析为兜底防御）。 */
export const mediaExtractInputSchema = z
  .object({
    [MEDIA_EXTRACT_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [MEDIA_EXTRACT_INPUT_KEYS.outputFormat]: z.enum(MEDIA_EXTRACT_OUTPUT_FORMATS),
  })
  .strict();
export type MediaExtractInput = z.infer<typeof mediaExtractInputSchema>;

/** 火山执行路径错误码面（映射口径全文 = 迁移契约 §18.x；数值码注册在 error-codes.ts）：
 *  三类映射——① 网关错误（HTTP 非 2xx / 成功态 error 信封 / 提交 SocketTimeout）复用既有
 *  通用码分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed 1011 / 提交超时
 *  provider_timeout 1012，NewApiErrorClassifier 同款，不新码）；② 火山任务失败（轮询
 *  status=failed）分类链兜底 + ③ 转存失败（result.audio_url 24h 临时链接 → 自家 TOS）
 *  统一归并本工具火山路径专属兜底码 ERROR_MEDIA_EXTRACT_PROVIDER_FAILED（数值 1044），
 *  与本地 ffmpeg 链路兜底 1020（media_extract_failed）区分——双执行路径并存期可从错误码
 *  区分失败来源（ADR-0103）。本地链路细分码（1023 无音轨 / 1024 下载失败 / 1025 超大 /
 *  1026 提取失败 / 1027 上传失败）保留给 ffmpeg 路径，火山路径不产生。 */
