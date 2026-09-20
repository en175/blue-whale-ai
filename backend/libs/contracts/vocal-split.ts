import { z } from "zod";

/* 人声背景分离（vocal_split）跨进程任务契约（IKHA2C）：
   术语见根 CONTEXT.md；接口契约唯一权威 = 火山引擎 AI MediaKit「人声背景音分离」官方
   PDF POST https://mediakit.cn-beijing.volces.com/api/v1/tools/separate-voice
   （**异步任务**：提交返 task_id，轮询查询按 scene 取 result 的 2/3 个音轨 URL 与
   duration——24 小时时效，worker 完成后须立即转存自家 TOS；本仓经 new-api 网关调用，
   参数名以官方 PDF 为准，出处逐条标注在常量注释，禁止引用二手信息）。
   与 media_extract 是两个独立契约（不共用文件）：输出格式枚举不同（本工具有 aac 无
   ogg、默认 aac）、scene 参数分叉多轨结果。跨进程字段在本文件定死后双端实现
   （红线：契约先行）：worker-java 侧同名常量类 VocalSplitContract（domain/contract），
   防漂移断言见 vocal-split.test.ts。执行面（消费者、处理器、领取 SQL、终态收口）
   由 IKHA2J 按附录 C 触点注册。 */

/** 任务类型值：generation_jobs.type 与 RocketMQ tag 同值（沿用既有 tag=type 口径）；
 *  backend 入队用 queue.constants.ts 的 VOCAL_SPLIT_TAG（与本常量恒等）。 */
export const VOCAL_SPLIT_JOB_TYPE = "vocal_split";

/** 任务来源值：人声分离只有画布媒体卡工具条一个创建入口，claim SQL 的 source 白名单
 *  仅含本值（video_subtitle_erase / video_enhance 的「专属来源值」同款模式；
 *  media_extract 的 "dock" 是 ADR-0103 存量迁移特例，新工具不沿用）。 */
export const VOCAL_SPLIT_SOURCE = "vocal_split";

/** input 冻结键名（三键恒在、值恒为合法枚举，创建时定死，重试原样沿用）。
 *  基础设施键 provider_credential 在业务键之上由创建侧冻结落库（同 media_extract /
 *  video-subtitle-erase 先例，不进本 zod——它校验的是客户端 payload，凭证来自请求头冻结）。 */
export const VOCAL_SPLIT_INPUT_KEYS = {
  /** 源素材身份（被分离音轨的视频/音频 Asset id；命名沿用 media_extract 的 source_asset_id）。 */
  sourceAssetId: "source_asset_id",
  /** 分离场景（见 VOCAL_SPLIT_SCENES；本仓产品语义小写键，出站映射官方 scene 首字母
   *  大写枚举，见 VOCAL_SPLIT_SCENE_UPSTREAM_MAP——与官方取值不同名，区别于抠图 scene
   *  的同名同值透传）。 */
  scene: "scene",
  /** 输出音频格式（见 VOCAL_SPLIT_OUTPUT_FORMATS；出站映射官方 output_format 参数，
   *  同名同值——注意本工具提交参数名是 output_format，不是 extract-audio 的 format）。 */
  outputFormat: "output_format",
} as const;

/** 分离场景枚举四档（文档出处：官方 PDF「进阶使用：选择分离场景」节 scene 取值表——
 *  Audio（默认，通用音视频）/ Music（音乐）/ Drama（短剧）/ Narrate（口播））。
 *  本仓产品语义用小写键，档位语义 = 通用 / 音乐 / 短剧 / 口播。 */
export const VOCAL_SPLIT_SCENES = ["audio", "music", "drama", "narrate"] as const;
export type VocalSplitScene = (typeof VOCAL_SPLIT_SCENES)[number];

/** 缺省场景 audio（文档出处：官方 PDF scene 节「Audio（默认）」）。创建请求体未传
 *  scene 时补本值后冻结；传了非法值（枚举外 / 非字符串 / null）明确拒绝，不静默回退。 */
export const VOCAL_SPLIT_DEFAULT_SCENE: VocalSplitScene = "audio";

/** scene 出站映射（文档出处：官方 PDF scene 取值表）：本仓小写产品键 → 官方枚举
 *  Audio / Music / Drama / Narrate（首字母大写），worker 出站请求处引用本表换算，
 *  禁止另行发明字面量。 */
export const VOCAL_SPLIT_SCENE_UPSTREAM_MAP: Record<VocalSplitScene, string> = {
  audio: "Audio",
  music: "Music",
  drama: "Drama",
  narrate: "Narrate",
};

/** 输出音频格式枚举（文档出处：官方 PDF「使用限制」节输出文件行——「通过 output_format
 *  参数指定输出音频格式，可选值为 aac、mp3、wav、m4a、flac，默认值为 aac」，与火山
 *  API 参数取值同名同值，出站原样透传）。**与 media_extract 枚举面不同**：有 aac 无
 *  ogg（extract-audio 恰好相反：有 ogg 无 aac），两契约各自冻结、禁止互抄。 */
export const VOCAL_SPLIT_OUTPUT_FORMATS = ["aac", "mp3", "wav", "m4a", "flac"] as const;
export type VocalSplitOutputFormat = (typeof VOCAL_SPLIT_OUTPUT_FORMATS)[number];

/** 缺省输出格式 aac（文档出处：官方 PDF「使用限制」节「默认值为 aac」——注意与
 *  extract-audio 默认 m4a 不同）。创建请求体未传 output_format 时补本值后冻结；
 *  非法值明确拒绝，不静默回退。 */
export const VOCAL_SPLIT_DEFAULT_OUTPUT_FORMAT: VocalSplitOutputFormat = "aac";

/** 网关异步提交路由（对客）：POST {VOCAL_SPLIT_SUBMIT_PATH}，网关按路径末段决定工具。
 *  火山上游侧对应官方 PDF「第 1 步：提交任务」节逐字
 *  POST /api/v1/tools/separate-voice，由网关内部转发，本仓不直连上游。
 *  ⚠️ 网关对客路径 ≠ 火山上游路径（IKH67T 实测：混用即 404 Invalid URL）；本值按
 *  家族惯例预占位（/v1/mediakit/{上游末段}），**网关票定稿后回填**。
 *  ⚠️ 轮询查询沿用三工具共用任务查询路由前缀（见 VOCAL_SPLIT_POLL_PATH_PREFIX）。 */
export const VOCAL_SPLIT_SUBMIT_PATH = "/v1/mediakit/separate-voice";

/** 网关异步任务查询路由前缀（拼 taskId）：GET {前缀}{task_id}。MediaKit 异步工具
 *  （去字幕 / 视频 HD / 音视频分离）共用同一条查询路由，路径**不含 async 段**；
 *  人声分离轮询同走本前缀（官方上游 GET /api/v1/tasks/{task_id} 由网关内部转发）。 */
export const VOCAL_SPLIT_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

/** 轨类型枚举（文档出处：官方 PDF scene 取值表「输出音轨」列——voice_audio_url 人声 /
 *  background_audio_url 背景音 / music_audio_url 音乐 / sfx_audio_url 音效）。
 *  本仓轨结果以轨类型键（track_type）承载，不用官方 URL 键名——URL 是供应商传输细节，
 *  转存自家 TOS 后对内只有 asset。 */
export const VOCAL_SPLIT_TRACK_TYPES = ["voice", "background", "music", "sfx"] as const;
export type VocalSplitTrackType = (typeof VOCAL_SPLIT_TRACK_TYPES)[number];

/** scene → 轨序（文档出处：官方 PDF scene 取值表——二分法适用于通用和音乐〔人声 +
 *  背景音两轨〕，三分法适用于短剧和口播〔人声 + 音乐 + 音效三轨〕）。voice 恒首轨；
 *  轨序即结果数组顺序，消费方按下标与轨类型双通道对位。expected_output_count 建单时
 *  按 VOCAL_SPLIT_SCENE_TRACKS[scene].length 落值（2 或 3）。 */
export const VOCAL_SPLIT_SCENE_TRACKS: Record<VocalSplitScene, readonly VocalSplitTrackType[]> = {
  audio: ["voice", "background"],
  music: ["voice", "background"],
  drama: ["voice", "music", "sfx"],
  narrate: ["voice", "music", "sfx"],
};

/** 单轨结果结构（任务终态对消费方的轨数组元素；跨进程新面，本契约定死）：
 *  每轨一资产——worker 逐轨转存 TOS 建 Asset 后，轨结果只携带身份与展示字段，
 *  禁止发明额外字段。 */
export interface VocalSplitTrackResult {
  /** 轨类型（见 VOCAL_SPLIT_TRACK_TYPES；scene 决定哪些轨出现与轨序）。 */
  track_type: VocalSplitTrackType;
  /** 该轨产物 Asset id（字符串形态，对齐 GET /api/jobs/:id 的 asset.id 投影口径）。 */
  asset_id: string;
  /** 该轨产物公开 URL（自家 TOS 转存后地址，非官方 24h 临时链接）。 */
  url: string;
  /** 该轨时长（秒；官方 result.duration 单值，逐轨冗余落同一值，结构自包含）。 */
  duration: number;
}

/** input 冻结结构（创建入口复核与重试沿用都用本 schema；strict 防多余键）。
 *  注意：这是**冻结后**形态（scene / output_format 已填默认值、三键恒在）；创建请求体里
 *  scene 与 output_format 均可选（缺省分别补 VOCAL_SPLIT_DEFAULT_SCENE /
 *  VOCAL_SPLIT_DEFAULT_OUTPUT_FORMAT 后再过本 schema），非法值在创建入口明确拒绝，
 *  worker 侧解析为兜底防御。 */
export const vocalSplitInputSchema = z
  .object({
    [VOCAL_SPLIT_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [VOCAL_SPLIT_INPUT_KEYS.scene]: z.enum(VOCAL_SPLIT_SCENES),
    [VOCAL_SPLIT_INPUT_KEYS.outputFormat]: z.enum(VOCAL_SPLIT_OUTPUT_FORMATS),
  })
  .strict();
export type VocalSplitInput = z.infer<typeof vocalSplitInputSchema>;

/** 执行面错误码归并口径（数值码注册在 error-codes.ts ERROR_VOCAL_SPLIT_FAILED=1046，
 *  TS 侧常量单源在 error-codes.ts，本文件不重复定义——去字幕 / media-extract 同款）：
 *  三类映射——① 网关错误（HTTP 非 2xx / 成功态 error 信封 / 提交 SocketTimeout）复用既有
 *  通用码分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed 1011 / 提交超时
 *  provider_timeout 1012，NewApiErrorClassifier 同款，不新码）；② 火山任务失败（轮询
 *  status=failed，含官方 scene 门槛拒绝等供应商侧拒绝）与 ③ 转存失败（result 各轨
 *  URL 24h 临时链接 → 自家 TOS，逐轨任一失败整单失败）统一归并本工具兜底码
 *  vocal_split_failed（1046），无 worker 级自动重试，用户手动重试沿用冻结 input。 */
