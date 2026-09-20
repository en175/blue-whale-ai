import { z } from "zod";

/* 音频截取（audio_trim，画布音频卡「截取」）跨进程任务契约（IKHB6F）：
   父单 IKHB08（遮罩选段+试听确认+火山 trim-audio 异步任务）；交互与参数口径 = ADR-0111
   （格式默认跟随源音频、贴边省略提交、精度三级）；术语见根 CONTEXT.md。
   接口契约唯一权威 = 火山引擎 AI MediaKit「提交音频裁剪任务 API」官方 PDF
   POST https://mediakit.cn-beijing.volces.com/api/v1/tools/trim-audio（**异步任务**：
   提交返 task_id，轮询查询取 result.audio_url（24h 临时链接）/ result.duration——本仓经
   new-api 网关调用；参数名以官方 PDF 为准，出处逐条标注在常量注释，禁止引用二手信息）。
   格式枚举独立于 media-extract（output_format 五值恰好同名同值，但两家族契约各自单源，
   互相不 import——枚举重合不构成共享理由）。
   跨进程字段在本文件定死后双端实现（红线：契约先行）：worker-java 侧同名常量类
   AudioTrimContract（domain/contract），防漂移断言见 audio-trim.test.ts。
   消费方接线由后续票 IKHB6N / IKHB6Y / IKHB7A 落地；任务来源值（claim source 白名单口径）
   不在本票规格，随接线票定死后补录。 */

/** 任务类型值：generation_jobs.type 与 RocketMQ tag 同值（tag=type 口径）。
 *  backend 入队 tag 常量（queue.constants.ts 的 AUDIO_TRIM_TAG）与 worker-java 的
 *  JobTypeEnum / GenerationMqRouteEnum 注册均由接线票落地（mq-route-parity.test.ts 对
 *  枚举表一一对应断言，本票不单侧先加）。 */
export const AUDIO_TRIM_JOB_TYPE = "audio_trim";

/** input 冻结键名（创建时定死，重试原样沿用）。
 *  基础设施键 provider_credential 在业务键之上由创建侧冻结落库（同 media-extract /
 *  video-subtitle-erase 先例，不进本 zod——它校验的是客户端 payload，凭证来自请求头冻结）。
 *  start_time / end_time 是**可选键**：贴边省略口径（见 buildAudioTrimTimeParams）下不传。 */
export const AUDIO_TRIM_INPUT_KEYS = {
  /** 源素材身份（被截取的音频 Asset id）。 */
  sourceAssetId: "source_asset_id",
  /** 截取开始时间（秒，最多两位小数；可选——选区左缘贴 0 时省略，走官方默认 0。出站映射
   *  官方 start_time 参数，同名同值）。 */
  startTime: "start_time",
  /** 截取结束时间（秒，最多两位小数；可选——选区右缘贴源全长时省略，走官方默认片尾。出站
   *  映射官方 end_time 参数，同名同值）。 */
  endTime: "end_time",
  /** 输出音频格式（见 AUDIO_TRIM_OUTPUT_FORMATS；本仓产品语义键名 output_format，出站换算
   *  官方 format 参数——IKHB6Y/7A 客户端落）。 */
  outputFormat: "output_format",
} as const;

/** 输出音频格式枚举（文档出处：官方 PDF Body 参数 format 节——「输出音频格式，支持 mp3、
 *  m4a、ogg、flac、wav。默认值为 m4a」，列举顺序照官方文档；与火山 API 参数取值同名同值，
 *  出站原样透传）。独立于 media-extract 的同形枚举，两家族各自单源。 */
export const AUDIO_TRIM_OUTPUT_FORMATS = ["mp3", "m4a", "ogg", "flac", "wav"] as const;
export type AudioTrimOutputFormat = (typeof AUDIO_TRIM_OUTPUT_FORMATS)[number];

/** 回退输出格式 m4a（文档出处：官方 PDF format 节「默认值为 m4a」；产品口径 ADR-0111
 *  「源格式不在枚举（如 aac）回退 m4a」——回退值与官方默认同值，双依据）。
 *  默认格式推导纯函数 defaultAudioTrimOutputFormat 的兜底分支用本值；显式传入的
 *  output_format 非法值（枚举外 / 非字符串 / null）在创建入口明确拒绝，不静默回退
 *  （media-extract / video-enhance 同款口径）。 */
export const AUDIO_TRIM_FALLBACK_OUTPUT_FORMAT: AudioTrimOutputFormat = "m4a";

/** 网关异步提交路由（对客）：POST {AUDIO_TRIM_SUBMIT_PATH}，网关按路径末段决定工具。
 *  火山上游侧对应官方 PDF「1. 提交音频裁剪任务 API」节逐字
 *  POST /api/v1/tools/trim-audio，由网关内部转发，本仓不直连上游。
 *  ⚠️ 网关路径 ≠ 火山上游路径（IKH67T 实测：混用即 404 Invalid URL，任务卡在提交相）；
 *  网关配置由独立拆票上线前置（IKH28Y / IKH8BK 先例，ADR-0111）。 */
export const AUDIO_TRIM_SUBMIT_PATH = "/v1/mediakit/trim-audio";

/** 网关异步任务查询路由前缀（拼 taskId）：GET {前缀}{task_id}。MediaKit 异步工具共用
 *  同一条查询路由，路径**不含 async 段**。 */
export const AUDIO_TRIM_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

/** 默认输出格式推导（纯函数，产品口径 ADR-0111「默认跟随源音频格式，按源文件名后缀推导；
 *  源格式不在五值枚举内（如 aac）回退 m4a」——截取不改变格式的用户预期，区别于分离家族
 *  的一刀切默认）。后缀大小写不敏感（.MP3 与 .mp3 同推 mp3）；无后缀 / 空文件名 / 枚举外
 *  后缀一律回退 m4a。web 面板默认选中与 backend 创建入口缺省补值共用本函数，两端不各自推导。 */
export function defaultAudioTrimOutputFormat(sourceFileName: string): AudioTrimOutputFormat {
  const dot = sourceFileName.lastIndexOf(".");
  const extension = dot >= 0 ? sourceFileName.slice(dot + 1).toLowerCase() : "";
  return (AUDIO_TRIM_OUTPUT_FORMATS as readonly string[]).includes(extension)
    ? (extension as AudioTrimOutputFormat)
    : AUDIO_TRIM_FALLBACK_OUTPUT_FORMAT;
}

/** 提交精度收口（纯函数）：秒、最多两位小数（文档出处：官方 PDF start_time / end_time 节
 *  「（单位：秒）。支持最多两位小数」——顶满 API 精度）。全精度浮点只在内部流转（ADR-0111
 *  精度三级：内部全精度、显示 0.1 秒、提交两位小数）；出站时间值必经本函数，web/backend
 *  不各自实现舍入。toFixed(2) 按值的双精度近似做最近舍入：十进制半分位字面量（如 60.555）
 *  的双精度近似可能略低于半分位而向下（→60.55），Math.round(x*100)/100 同值同向；官方只
 *  约束「最多两位小数」，量化结果恒合法，且显示面 0.1 秒精度下该 0.005 秒边界无感知差异。 */
export function roundAudioTrimSeconds(seconds: number): number {
  return Number(seconds.toFixed(2));
}

/** 贴边省略的入参（内部全精度浮点，秒）。 */
export interface AudioTrimTimeRange {
  /** 选区左缘（秒）。 */
  start: number;
  /** 选区右缘（秒）。 */
  end: number;
  /** 源音频全长（秒；上传时长为整秒精度——probeMediaMeta Math.round，ADR-0111）。 */
  sourceDuration: number;
}

/** 贴边省略（纯函数，产品口径 ADR-0111）：选区左缘贴 0 省略 start_time（走官方默认「从
 *  音频开头开始」）、右缘贴源全长省略 end_time（走官方默认「裁剪到输入音频末尾」），规避
 *  上传时长整秒精度导致 end_time 超真实片尾的超界风险；中间段照常传值。
 *  贴边判定在全精度上做精确相等（选区边界值即前端从 0 / sourceDuration 初始化的同一数值），
 *  判定后未省略的值再经 roundAudioTrimSeconds 收口两位小数——判定在先、量化在后。
 *  web 发送条组参与 backend 创建入口复核共用本函数，口径只此一份。 */
export function buildAudioTrimTimeParams({
  start,
  end,
  sourceDuration,
}: AudioTrimTimeRange): { start_time?: number; end_time?: number } {
  const params: { start_time?: number; end_time?: number } = {};
  if (start !== 0) {
    params.start_time = roundAudioTrimSeconds(start);
  }
  if (end !== sourceDuration) {
    params.end_time = roundAudioTrimSeconds(end);
  }
  return params;
}

/** input 冻结结构（创建入口复核与重试沿用都用本 schema；strict 防多余键）。
 *  这是**冻结后**形态：output_format 恒为合法枚举（创建请求体缺省时先经
 *  defaultAudioTrimOutputFormat 补值再过本 schema，显式非法值明确拒绝）；start_time /
 *  end_time 可选（贴边省略口径，undefined = 走官方默认片头片尾），两值同传时必须
 *  start_time < end_time（文档出处：官方 PDF「必须小于 end_time / 必须大于 start_time」），
 *  且两值均非负、最多两位小数（提交精度在契约层收口，超精度在创建入口即拒）。 */
const twoDecimalPlaces = z
  .number()
  .nonnegative()
  .refine((value) => roundAudioTrimSeconds(value) === value, {
    message: "最多两位小数（官方 API 精度上限）",
  });

export const audioTrimInputSchema = z
  .object({
    [AUDIO_TRIM_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [AUDIO_TRIM_INPUT_KEYS.startTime]: twoDecimalPlaces.optional(),
    [AUDIO_TRIM_INPUT_KEYS.endTime]: twoDecimalPlaces.optional(),
    [AUDIO_TRIM_INPUT_KEYS.outputFormat]: z.enum(AUDIO_TRIM_OUTPUT_FORMATS),
  })
  .strict()
  .refine(
    (input) =>
      input.start_time === undefined || input.end_time === undefined || input.start_time < input.end_time,
    { message: "start_time 必须小于 end_time" },
  );
export type AudioTrimInput = z.infer<typeof audioTrimInputSchema>;

/** 执行面错误码归并口径（数值码注册在 error-codes.ts ERROR_AUDIO_TRIM_FAILED=1046，
 *  TS 侧常量单源在 error-codes.ts，本文件不重复定义——media-extract / video-enhance 同款）：
 *  三类映射——① 网关错误（HTTP 非 2xx / 成功态 error 信封 / 提交 SocketTimeout）复用既有
 *  通用码分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed 1011 / 提交超时
 *  provider_timeout 1012，NewApiErrorClassifier 同款，不新码）；② 火山任务失败（轮询
 *  status=failed——含 end_time 超真实片尾等供应商侧官方约束拒绝）与 ③ 转存失败
 *  （result.audio_url 24h 临时链接 → 自家 TOS）统一归并本工具兜底码 audio_trim_failed
 *  （1046），无 worker 级自动重试，上游可读原因随 message 透传前端投影，用户手动重试
 *  沿用冻结 input。 */
