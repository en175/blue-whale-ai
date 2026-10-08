import { z } from "zod";

/* 视频插帧（video_frame_interpolation，火山 MediaKit video-frame-interpolation）跨进程任务契约
   （IKHLK3，父需求 IKHLES 画布视频插帧）：术语见根 GLOSSARY.md「画布视频插帧」词条组，入口形态与
   帧率三档口径 = ADR-0113。接口契约唯一权威 = 火山引擎 AI MediaKit 参数级 API 参考页
   （**异步任务**：提交返 task_id，轮询查询取 result.video_url（24h 临时链接）/ duration /
   resolution / fps；本仓经 new-api 网关调用）。官方出处逐条标注在常量注释，禁止引用二手信息，
   资料未明确的字段显式标注「官方未明确」——核对结论落盘 docs/specs/2026-09-21-video-frame-interpolation-mediakit.md。
   跨进程字段在本文件定死后双端实现（红线：契约先行）：worker-java 侧同名常量类
   VideoFrameInterpolationContract（domain/contract），防漂移断言见 video-frame-interpolation.test.ts。
   执行面（消费者、处理器、领取 SQL、终态收口）由 worker 票 IKHLKJ 按附录 C 触点注册。 */

/** 任务类型值：generation_jobs.type 与 RocketMQ tag 同值（沿用既有 tag=type 口径；命名对齐火山
 *  工具名 video-frame-interpolation，DB/tag 侧按家族口径转下划线）。
 *  backend 入队用 queue.constants.ts 的 VIDEO_FRAME_INTERPOLATION_TAG（与本常量恒等）。 */
export const VIDEO_FRAME_INTERPOLATION_JOB_TYPE = "video_frame_interpolation";

/** 任务来源值：插帧只有画布视频卡「高清 ▾」下拉第二项一个创建入口，claim SQL 的 source 白名单
 *  仅含本值（video_enhance / video_scene_split 的专属来源值同款模式）。 */
export const VIDEO_FRAME_INTERPOLATION_SOURCE = "video_frame_interpolation";

export const VIDEO_FRAME_INTERPOLATION_INPUT_KEYS = {
  /** 源素材身份（被插帧的视频 Asset id；命名沿用 media_extract / video_enhance 家族的
   *  source_asset_id）。 */
  sourceAssetId: "source_asset_id",
  /** 目标节点身份（画布插帧卡 node id，前端回填结果时定位用；插帧是进入即建草稿卡
   *  （ADR-0113 建卡口径照抄 HD 高清），node id 由前端生成传入，worker 不消费画布拓扑）。 */
  targetNodeId: "target_node_id",
  /** 目标帧率（见 VIDEO_FRAME_INTERPOLATION_FPS_VALUES；**整型直传**官方同名字段 fps，
   *  ADR-0113「契约与代码层命名对齐火山命名，fps 直传整型」）。 */
  fps: "fps",
} as const;

/** 目标帧率三档（文档出处：官方 PDF《视频插帧》「fps：目标输出帧率，取值范围为 [15, 120]」与
 *  参数级 API 参考页 Body 参数 fps 节同口径）。**本仓只暴露产品三档 30 / 60 / 120**
 *  （ADR-0113：Seedance 24fps 生成视频提到 60 为主场景、30 档留给低帧率上传视频、120 满足高刷；
 *  三档是官方 [15,120] 的真子集），枚举外值（含官方合法但产品未暴露的 45）在创建入口明确拒绝；
 *  出站原样透传官方 fps 参数。官方另一条口径（同节）：「如果设置的目标帧率低于原视频帧率，
 *  系统会先执行智能插帧处理，然后通过降帧的方式以达到最终的目标帧率」——故 30 档对 60fps
 *  源视频是合法降帧路径，不做源帧率比较拦截。 */
export const VIDEO_FRAME_INTERPOLATION_FPS_VALUES = [30, 60, 120] as const;
export type VideoFrameInterpolationFps =
  (typeof VIDEO_FRAME_INTERPOLATION_FPS_VALUES)[number];

/** 缺省目标帧率 60（ADR-0113「帧率三档 30/60/120，默认 60」——面板三档分段恒有选中值，
 *  本常量是产品默认档单源（前端面板默认选中与此同源）。
 *  **与 HD 高清 resolution 必填口径不同**：HD 是「面板恒有值、创建入口三键必填」，插帧按父单
 *  决策支持缺省补默认（fps 键缺省时补 60，见 videoFrameInterpolationInputSchema）。 */
export const VIDEO_FRAME_INTERPOLATION_DEFAULT_FPS: VideoFrameInterpolationFps = 60;

/** 网关异步提交路由（对客）：POST {VIDEO_FRAME_INTERPOLATION_SUBMIT_PATH}，网关按路径末段决定工具。
 *  火山上游侧对应官方参数级 API 参考页逐字
 *  POST https://mediakit.cn-beijing.volces.com/api/v1/tools/video-frame-interpolation，
 *  由网关内部转发，本仓不直连上游。
 *  ⚠️ 网关路径 ≠ 火山上游路径（video_enhance 的 IKH67T 实测：混用即 404 Invalid URL，任务卡在提交相）：
 *  本常量按家族规律（`/v1/mediakit/{与上游同名的工具段}`）取 **假设值**，随网关票 IKHLLB 对齐后定稿
 *  ——本常量是全仓单源，定稿只改这一处（Java 镜像常量与防漂移测试同步）。 */
export const VIDEO_FRAME_INTERPOLATION_SUBMIT_PATH =
  "/v1/mediakit/video-frame-interpolation";

/** 网关异步任务查询路由前缀（拼 taskId）：GET {前缀}{task_id}。MediaKit 异步工具共用同一条查询
 *  路由，路径**不含 async 段**（与 video_enhance 同值，官方查询 API 为统一入口：
 *  「支持查询 AI MediaKit 服务下所有类型的异步任务」）。 */
export const VIDEO_FRAME_INTERPOLATION_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

/** 官方 result 字段名（文档出处：参数级 API 参考页「异步任务结果」表——video_url / duration /
 *  resolution / fps 四字段；duration 单位秒「用于计量计费」、resolution 为输出分辨率档位
 *  「插帧不改变分辨率，跟随原片」（取值范围 240p/360p/480p/540p/720p/1080p/2k/4k/8k）、fps
 *  「与提交任务时指定的目标帧率一致」）。worker 转存与终态写入引用本表，禁止另行发明字段名；
 *  **本仓不新增卡片/资产 fps 元数据链**（ADR-0113：全链不新增 fps 元数据字段，assets 表无 fps 列，
 *  输出帧率随终态日志 payload 承载）。 */
export const VIDEO_FRAME_INTERPOLATION_RESULT_KEYS = {
  videoUrl: "video_url",
  duration: "duration",
  resolution: "resolution",
  fps: "fps",
} as const;

/** input 冻结结构（创建入口复核与重试沿用都用本 schema；strict 防多余键）。
 *  三键恒在：source_asset_id / target_node_id 必填，fps **缺省补默认 60**
 *  （父单决策口径，区别于 HD 高清 resolution 的「必填无缺省分支」）。 */
export const videoFrameInterpolationInputSchema = z
  .object({
    [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.sourceAssetId]: z
      .string()
      .regex(/^[1-9][0-9]*$/),
    [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId]: z.string().min(1),
    // z.literal([...取值]) = 多值字面量联合（zod 4）：整型三档直传，字符串 "60" 与 60.5 一律拒。
    [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.fps]: z
      .literal([...VIDEO_FRAME_INTERPOLATION_FPS_VALUES])
      .default(VIDEO_FRAME_INTERPOLATION_DEFAULT_FPS),
  })
  .strict();
export type VideoFrameInterpolationInput = z.infer<
  typeof videoFrameInterpolationInputSchema
>;

/** 恢复查询契约（IKHSFE，PR !820 合入前整改）：浏览器未收到创建响应就关页时，前端只持有
 *  草稿卡的 target_node_id（本地生成、不落库），服务端按「项目 + 目标节点」查回当前任务，
 *  供重新进入画布恢复关联。路由：GET /api/projects/:projectId/video-frame-interpolations/current
 *  ?target_node_id=xxx（控制器路径段常量 = 本值；查询键复用 VIDEO_FRAME_INTERPOLATION_INPUT_KEYS
 *  .targetNodeId，不另造键名）。 */
export const VIDEO_FRAME_INTERPOLATION_RECOVERY_ROUTE_SEGMENT = "current";

export const VIDEO_FRAME_INTERPOLATION_RECOVERY_RESPONSE_KEYS = {
  /** 当前关联任务 id（无任何关联任务时整个 data 为 null，不另设空对象形态）。 */
  jobId: "job_id",
  /** 任务状态（generation_jobs.status 原值，前端据此决定恢复轮询或呈现终态）。 */
  status: "status",
  /** 进度百分比原值（终态恒 0 或 100，按库值透传）。 */
  progress: "progress",
  /** 创建时间 ISO 串（gmt_create，前端展示与调试用）。 */
  createdAt: "created_at",
} as const;

/** 恢复查询入参 schema（strict 单键：target_node_id 必填非空字符串；多余键拒——服务端只挑
 *  本键透传，与创建 payload 的 strict 口径同源）。 */
export const videoFrameInterpolationRecoveryQuerySchema = z
  .object({
    [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId]: z.string().min(1),
  })
  .strict();
export type VideoFrameInterpolationRecoveryQuery = z.infer<
  typeof videoFrameInterpolationRecoveryQuerySchema
>;

/** 执行面错误码归并口径（数值码注册在 error-codes.ts
 *  ERROR_VIDEO_FRAME_INTERPOLATION_FAILED = 1049，TS 侧常量单源在 error-codes.ts，本文件不重复
 *  定义——video_enhance / video_scene_split 同款）：
 *  三类映射——① 网关错误（HTTP 非 2xx / 成功态 error 信封 / 提交 SocketTimeout）复用既有通用码
 *  分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed 1011 / 提交超时 provider_timeout
 *  1012，NewApiErrorClassifier 同款，不新码）；② 火山任务失败（轮询 status=failed，官方错误码表
 *  的通用码如 InvalidParameter / DownloadFileError / AbilityProcessingError 等均在其中——含
 *  **入口未前置判定的官方门槛拒绝**，如目标帧率实际落在 [15,120] 外、输入文件规格不符、文件大小
 *  或时长超出上游限制）与 ③ 转存失败（result.video_url 24h 临时链接 → 自家 TOS）统一归并本工具
 *  兜底码 video_frame_interpolation_failed（1049），无 worker 级自动重试，上游可读原因随 message
 *  透传前端投影，用户手动重试沿用冻结 input。对客文案由码表给出（「视频插帧失败，请重试」）。
 *  入队失败（RocketMQ 投递异常）不走本码：沿用家族口径落 ERROR_ENQUEUE_FAILED（1028）。 */
