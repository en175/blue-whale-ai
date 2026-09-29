import { z } from "zod";

/* 视频 HD 高清（video_enhance，火山 MediaKit 画质增强大模型版）跨进程任务契约（IKH3VE）：
   父规格 IKH3VB；术语见根 GLOSSARY.md「画布视频 HD 高清」；面板极简骨架与参数裁剪口径 =
   ADR-0105。接口契约唯一权威 = 火山引擎 AI MediaKit「提交画质增强（大模型版）任务 API」
   官方 PDF POST https://mediakit.cn-beijing.volces.com/api/v1/tools/enhance-video-generative
   （**异步任务**：提交返 task_id，轮询查询取 result.video_url（24h 临时链接）/ duration /
   resolution / fps；本仓经 new-api 网关调用；参数名以官方 PDF 为准，出处逐条标注在常量
   注释，禁止引用二手信息）。⚠️ 官方文档内部矛盾：失败示例报错文案写 resolution 仅
   [720p,1080p]，以 Body 参数表（720p 默认 / 1080p / 2k / 4k）与附录码率参考表（含 2K/4K
   行）为准。跨进程字段在本文件定死后双端实现（红线：契约先行）：worker-java 侧同名常量类
   VideoEnhanceContract（domain/entity），防漂移断言见 video-enhance.test.ts。
   执行面（消费者、处理器、领取 SQL、终态收口）由 worker 票按附录 C 触点注册。 */

/** 任务类型值：generation_jobs.type 与 RocketMQ tag 同值（沿用既有 tag=type 口径）；
 *  backend 入队用 queue.constants.ts 的 VIDEO_ENHANCE_TAG（与本常量恒等）。 */
export const VIDEO_ENHANCE_JOB_TYPE = "video_enhance";

/** 任务来源值：HD 高清只有画布视频卡工具条「HD」单按钮一个创建入口，claim SQL 的
 *  source 白名单仅含本值（video_subtitle_erase / image_erase 的专属来源值同款模式）。 */
export const VIDEO_ENHANCE_SOURCE = "video_enhance";

/** input 冻结键名（三键恒在、值恒为合法枚举，创建时定死，重试原样沿用）。
 *  基础设施键 provider_credential 在业务键之上由创建侧冻结落库（同 video-subtitle-erase
 *  先例，不进本 zod——它校验的是客户端 payload，凭证来自请求头冻结）。 */
export const VIDEO_ENHANCE_INPUT_KEYS = {
  /** 源素材身份（被增强的视频 Asset id；命名沿用 media_extract / video_subtitle_erase
   *  的 source_asset_id）。 */
  sourceAssetId: "source_asset_id",
  /** 目标节点身份（画布 HD 高清卡 node id，前端回填结果时定位用；HD 高清是进入即建
   *  草稿卡（ADR-0105 建卡口径照抄图片高清放大），node id 由前端生成传入，worker 不消费画布拓扑）。 */
  targetNodeId: "target_node_id",
  /** 目标分辨率（见 VIDEO_ENHANCE_RESOLUTIONS；本仓产品语义键名 resolution，出站同名同值
   *  透传官方 resolution 参数）。 */
  resolution: "resolution",
} as const;

/** 目标分辨率枚举（文档出处：官方 PDF Body 参数 resolution 节——可选值 720p（默认值）/
 *  1080p / 2k / 4k）。**本仓暴露 API 原生值 1080p / 2k / 4k 三档，720p 被产品裁掉不暴露**
 *  （ADR-0105：产品语义为「高清」，默认 720P 名不副实；默认档改 1080P，见
 *  VIDEO_ENHANCE_DEFAULT_RESOLUTION）；出站原样透传，非法值（含 720p）在创建入口明确拒绝。 */
export const VIDEO_ENHANCE_RESOLUTIONS = ["1080p", "2k", "4k"] as const;
export type VideoEnhanceResolution = (typeof VIDEO_ENHANCE_RESOLUTIONS)[number];

/** 缺省目标分辨率 1080p（产品口径 ADR-0105「目标分辨率只提供 1080P/2K/4K 三档，默认
 *  1080P」——**不是官方默认 720p**）。面板三档分段恒有选中值、创建入口三键必填，本常量
 *  是产品默认档单源（前端面板默认选中与此同源）。 */
export const VIDEO_ENHANCE_DEFAULT_RESOLUTION: VideoEnhanceResolution = "1080p";

/** 网关异步提交路由（对客）：POST {VIDEO_ENHANCE_SUBMIT_PATH}，网关按路径末段决定工具。
 *  火山上游侧对应官方 PDF「1. 提交画质增强（大模型版）任务 API」节逐字
 *  POST /api/v1/tools/enhance-video-generative，由网关内部转发，本仓不直连上游。
 *  ⚠️ 网关路径 ≠ 火山上游路径（IKH67T 实测：混用即 404 Invalid URL，任务卡在提交相）。 */
export const VIDEO_ENHANCE_SUBMIT_PATH = "/v1/mediakit/enhance-video-generative";

/** 网关异步任务查询路由前缀（拼 taskId）：GET {前缀}{task_id}。三个 MediaKit 异步工具
 *  共用同一条查询路由，路径**不含 async 段**。 */
export const VIDEO_ENHANCE_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

/** 出站固定码率档位 medium（文档出处：官方 PDF Body 参数 bitrate_level 节——low / medium
 *  （推荐）/ high，默认 medium）。服务端常量、不进契约输入键与面板参数（ADR-0105「码率固定
 *  medium、不暴露」）：worker 出站请求处引用本常量，禁止另行发明字面量。
 *  fps 同口径**不传**（官方：未指定时输出保持与原始片源一致的帧率；ADR-0105「帧率保持
 *  原片不暴露」）——无键即无值，故 fps 不设常量，本注释即 fps 口径单源。 */
export const VIDEO_ENHANCE_BITRATE_LEVEL = "medium";

/** 输入门槛常量（文档出处：官方 PDF video_url 参数「输入视频限制」节——「最高支持 1080p。
 *  具体规格要求：短边范围 [360,1080]、长边范围 [360,1920]」；消费方 = backend 创建入口
 *  复核 + web 按钮门槛预检（两端判定与数值只此一份）；worker-java 不做门槛复核——宽高
 *  缺失的存量放行，交供应商按官方门槛拒。短边/长边语义：取宽高较小者为短边、较大者为
 *  长边，竖屏 1080x1920 合法。仅 SDR 的限制无前置元数据，由任务失败口径兜底（ADR-0105）。 */
export const VIDEO_ENHANCE_MIN_INPUT_SHORT_SIDE_PX = 360;
export const VIDEO_ENHANCE_MAX_INPUT_SHORT_SIDE_PX = 1080;
export const VIDEO_ENHANCE_MIN_INPUT_LONG_SIDE_PX = 360;
export const VIDEO_ENHANCE_MAX_INPUT_LONG_SIDE_PX = 1920;
/** 格式面：官方支持 mp4 / flv / ts / avi / mov / wmv / mkv 等主流视频格式（文档「等主流
 *  视频格式」为开放式列举）——**不做格式预检白名单**（同 video-subtitle-erase 口径：我方
 *  上传面 video/* 全部在官方支持面内），故不设格式常量，本注释即格式面口径单源。 */

/** input 冻结结构（创建入口复核与重试沿用都用本 schema；strict 防多余键）。
 *  三键恒在：resolution 必填（面板默认 1080P 恒有值，无缺省补默认分支——去字幕
 *  detect_mode 必填同款口径，区别于 media_extract output_format 的历史可选）。 */
export const videoEnhanceInputSchema = z
  .object({
    [VIDEO_ENHANCE_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [VIDEO_ENHANCE_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [VIDEO_ENHANCE_INPUT_KEYS.resolution]: z.enum(VIDEO_ENHANCE_RESOLUTIONS),
  })
  .strict();
export type VideoEnhanceInput = z.infer<typeof videoEnhanceInputSchema>;

/** 执行面错误码归并口径（数值码注册在 error-codes.ts ERROR_VIDEO_ENHANCE_FAILED=1045，
 *  TS 侧常量单源在 error-codes.ts，本文件不重复定义——去字幕 / media-extract 同款）：
 *  三类映射——① 网关错误（HTTP 非 2xx / 成功态 error 信封 / 提交 SocketTimeout）复用既有
 *  通用码分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed 1011 / 提交超时
 *  provider_timeout 1012，NewApiErrorClassifier 同款，不新码）；② 火山任务失败（轮询
 *  status=failed——**含 SDR 限制、短边/长边超限等供应商侧官方门槛拒绝**，宽高缺失放行的
 *  存量由上游拒，ADR-0105 任务失败口径兜底）与 ③ 转存失败（result.video_url 24h 临时链接
 *  → 自家 TOS）统一归并本工具兜底码 video_enhance_failed（1045），无 worker 级自动重试，
 *  上游可读原因随 message 透传前端投影，用户手动重试沿用冻结 input。 */
