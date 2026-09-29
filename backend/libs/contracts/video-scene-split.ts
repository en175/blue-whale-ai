import { z } from "zod";

/* 视频场景切分（video_scene_split，火山 MediaKit segment-scenes）跨进程任务契约（IKH8BH）：
   父规格 IKH86V（画布视频「场景切分」一对多逐段扇出，设计定案 ADR-0108）；术语见根
   GLOSSARY.md「画布视频场景切分」。接口契约唯一权威 = 火山引擎 AI MediaKit「提交场景切分
   任务 API」官方 PDF POST https://mediakit.cn-beijing.volces.com/api/v1/tools/segment-scenes
   （**异步任务**：提交返 task_id，轮询查询取 result.duration + result.segments[]——本仓经
   new-api 网关调用；参数名以官方 PDF 为准，出处逐条标注在常量注释，禁止引用二手信息）。
   跨进程字段在本文件定死后双端实现（红线：契约先行）：worker-java 侧同名常量类
   VideoSceneSplitContract（domain/contract），防漂移断言见 video-scene-split.test.ts。
   结果回填约定：成功时 worker 轮询至 completed 后逐段下载切片（火山 segment_video_url
   仅 24h 有效）→ 落对象存储公开读 → 每段建 Asset（type=video / source='generated' /
   generation_job_id）→ 终态 succeeded，段序/起止秒/段资产引用/总时长按本文件 result
   契约跨进程回传，前端完成事件驱动移除任务占位卡、按段扇出 N 张段卡（ADR-0108，
   1 段不特判照常扇出）；失败时落 failed 与既有错误码投影（兜底
   video_scene_split_failed，数值 1046——1045 已由视频 HD 高清占用），无 worker 级
   自动重试，用户在任务占位卡手动重试并沿用冻结 input。执行面（消费者、处理器、领取
   SQL、终态收口）由 worker 票按附录 C 触点注册，创建入口行为由创建入口票承载。 */

/** 任务类型值：generation_jobs.type 与 RocketMQ tag 同值（沿用既有 tag=type 口径）；
 *  backend 入队用 queue.constants.ts 的 VIDEO_SCENE_SPLIT_TAG（与本常量恒等）。 */
export const VIDEO_SCENE_SPLIT_JOB_TYPE = "video_scene_split";

/** 任务来源值：场景切分只有画布视频卡工具条「场景切分」单按钮一个创建入口，claim SQL 的
 *  source 白名单仅含本值（video_enhance / video_subtitle_erase 的专属来源值同款模式）。 */
export const VIDEO_SCENE_SPLIT_SOURCE = "video_scene_split";

/** input 冻结键名（三键恒在、粒度恒为合法枚举，创建时定死，重试原样沿用）。
 *  基础设施键 provider_credential（请求头冻结）与 client_token（提交幂等键，消费方是
 *  command_idempotency 表）在业务键之上由创建侧处理（同 video-subtitle-erase 先例，
 *  均不进本 zod——它校验的是客户端业务 payload）。
 *  IKH8BO 扩展：补 target_node_id（画布任务占位卡绑定键）——先例 video_enhance /
 *  video_subtitle_erase 同款；画布单写入方架构（IKFS5W：后端停写 nodes_json，前端唯一
 *  写入方）下「任务与占位数据同事务创建」的落法 = 占位卡绑定随任务 input 原子落库，
 *  前端按本键把 job 映射到它本地创建并随画布保存的任务占位卡（轮询终态/完成扇出/失败
 *  重试都以本键找到卡）。 */
export const VIDEO_SCENE_SPLIT_INPUT_KEYS = {
  /** 源素材身份（被切分的视频 Asset id；命名沿用 media_extract / video_subtitle_erase /
   *  video_enhance 的 source_asset_id）。 */
  sourceAssetId: "source_asset_id",
  /** 画布任务占位卡节点绑定（前端发送前本地建占位卡生成的节点 id；video_enhance /
   *  video_subtitle_erase 的 target_node_id 同款语义——前端 GET /api/jobs/:id 按 input
   *  里的本键把任务回填/移除到对应卡）。 */
  targetNodeId: "target_node_id",
  /** 切分粒度档（见 VIDEO_SCENE_SPLIT_GRANULARITIES；本仓产品语义值，出站经
   *  VIDEO_SCENE_SPLIT_SEGMENT_THRESHOLD 映射官方 segment_threshold 数值——见该映射表）。 */
  granularity: "granularity",
} as const;

/** 切分粒度枚举（**本仓产品语义命名，非官方参数值**——官方只有数值 segment_threshold，
 *  无档位概念；三档是产品对 threshold 的收敛，出站经 VIDEO_SCENE_SPLIT_SEGMENT_THRESHOLD
 *  映射换算，见各档注释）。粒度选择不跨会话记忆，每次进入编辑态重置为默认档。 */
export const VIDEO_SCENE_SPLIT_GRANULARITIES = ["fine", "standard", "coarse"] as const;
export type VideoSceneSplitGranularity = (typeof VIDEO_SCENE_SPLIT_GRANULARITIES)[number];

/** 粒度档 → 官方 segment_threshold 数值映射（单处定义，worker 出站请求处换算；文档出处：
 *  官方 PDF「调整切分粒度」节 segment_threshold——场景切分敏感度阈值，范围 [0, 100)，
 *  推荐经验值 10，值越低切得越细碎、越高越粗略）。
 *  - fine（细）= 5：对画面变化更敏感，切得更碎；
 *  - standard（标准）= 10：官方推荐经验值，默认档；
 *  - coarse（粗）= 20：忽略不那么显著的场景变化，切得更粗。
 *  三档数值为**契约初值**：后续按真实切分效果微调时只改本映射与映射测试（父规格定案）。
 *  出站口径：只传 segment_threshold——min_duration（默认 3s）/ max_duration（默认 30s）/
 *  enable_clip_fade（默认 false）/ return_segment_videos（默认 true）一律不传，走服务端
 *  默认（规格 Implementation Decisions「高级参数不暴露」）——无键即无值，故不设常量，
 *  本注释即出站参数口径单源（同 video-enhance fps 口径模式）。 */
export const VIDEO_SCENE_SPLIT_SEGMENT_THRESHOLD: Record<VideoSceneSplitGranularity, number> = {
  fine: 5,
  standard: 10,
  coarse: 20,
};

/** 缺省粒度档 standard（产品口径「默认标准」= 官方推荐经验值 10）。面板三档分段恒有
 *  选中值、创建入口两键必填，本常量是前端面板默认档单源（与粒度不跨会话记忆口径配套：
 *  每次进入编辑态重置为本值）。 */
export const VIDEO_SCENE_SPLIT_DEFAULT_GRANULARITY: VideoSceneSplitGranularity = "standard";

/** 网关异步提交路由（对客）：POST {VIDEO_SCENE_SPLIT_SUBMIT_PATH}，网关按路径末段决定工具。
 *  火山上游侧对应官方 PDF「第 1 步：提交任务」节逐字
 *  POST /api/v1/tools/segment-scenes，由网关内部转发，本仓不直连上游。
 *  ⚠️ 网关路径 ≠ 火山上游路径（IKH67T 实测：混用即 404 Invalid URL，任务卡在提交相）。 */
export const VIDEO_SCENE_SPLIT_SUBMIT_PATH = "/v1/mediakit/segment-scenes";

/** 网关异步任务查询路由前缀（拼 taskId）：GET {前缀}{task_id}。四个 MediaKit 异步工具
 *  （去字幕 / 视频 HD / 音视频分离 / 场景切分）共用同一条查询路由，路径**不含 async 段**；
 *  status 枚举 running / completed / failed，查询窗口 30 天。 */
export const VIDEO_SCENE_SPLIT_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

/** 对客模型名（网关按模型名路由 MediaKit 渠道并计次计费，场景切分网关配零价为上线前置）。
 *  候选值 mediakit-segment-scenes——**最终以网关配置票为准**，有出入只改本常量与对账
 *  测试（同 NewApiMediaKitEnhanceVideoClient.MODEL 候选口径；本票把它升为契约常量，
 *  创建入口与 worker 出站统一引用，禁止另行发明字面量）。 */
export const VIDEO_SCENE_SPLIT_MODEL_NAME = "mediakit-segment-scenes";

/** input 冻结结构（创建入口复核与重试沿用都用本 schema；strict 防多余键）。
 *  三键恒在：granularity 必填（面板默认恒有值，无缺省补默认分支——video_enhance 的
 *  resolution 必填同款口径，区别于 media_extract output_format 的历史可选）；
 *  target_node_id 必填非空（占位卡先建后发，IKH8BO 扩展）。 */
export const videoSceneSplitInputSchema = z
  .object({
    [VIDEO_SCENE_SPLIT_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [VIDEO_SCENE_SPLIT_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [VIDEO_SCENE_SPLIT_INPUT_KEYS.granularity]: z.enum(VIDEO_SCENE_SPLIT_GRANULARITIES),
  })
  .strict();
export type VideoSceneSplitInput = z.infer<typeof videoSceneSplitInputSchema>;

/** result 冻结键名（跨进程结果契约——worker 写入、前端扇出消费都用本组键；官方
 *  result.duration / result.segments[] 的本仓跨进程形态：官方 segment_video_url 是
 *  24h 临时链接**不进契约**，段资产以自有存储 Asset id 引用，工单定死）。 */
export const VIDEO_SCENE_SPLIT_RESULT_KEYS = {
  /** 视频总时长（秒；官方 result.duration，同名同值透传）。 */
  duration: "duration",
  /** 场景段列表（见 VIDEO_SCENE_SPLIT_SEGMENT_KEYS；按官方 segments[] 返回顺序排列）。 */
  segments: "segments",
} as const;

/** 段对象键名（结果契约的段内四要素：段序、起止秒、段资产引用——工单定死；
 *  start_time / end_time 与官方 result.segments[] 同名同值〔秒〕，segment_index 与
 *  segment_asset_id 为本仓产品语义字段）。 */
export const VIDEO_SCENE_SPLIT_SEGMENT_KEYS = {
  /** 段序（1 起正整数，按官方 segments[] 返回顺序编号；与前端段卡标注「第 N 段」同源，
 *      1 段与 N 段同构不特判——第 1 段照常编号 1）。 */
  segmentIndex: "segment_index",
  /** 段起始秒（Number，≥0；官方 start_time）。 */
  startTime: "start_time",
  /** 段结束秒（Number，>start_time；官方 end_time）。 */
  endTime: "end_time",
  /** 段资产引用（自有存储段视频 Asset id——worker 逐段下载官方切片转存后建的 Asset；
   *    段卡素材地址指向自有存储，不得直连火山 24h 临时链接，规格故事 23）。 */
  segmentAssetId: "segment_asset_id",
} as const;

/** result 冻结结构（strict 防多余键）。segments 恒为数组（min(1)、无上限）：整片只切出
 *  1 段时结构与 N 段完全一致不特判（规格故事 18——用户可换「细」档重试）。 */
export const videoSceneSplitResultSchema = z
  .object({
    [VIDEO_SCENE_SPLIT_RESULT_KEYS.duration]: z.number().nonnegative(),
    [VIDEO_SCENE_SPLIT_RESULT_KEYS.segments]: z
      .array(
        z
          .object({
            [VIDEO_SCENE_SPLIT_SEGMENT_KEYS.segmentIndex]: z.number().int().positive(),
            [VIDEO_SCENE_SPLIT_SEGMENT_KEYS.startTime]: z.number().nonnegative(),
            [VIDEO_SCENE_SPLIT_SEGMENT_KEYS.endTime]: z.number().positive(),
            [VIDEO_SCENE_SPLIT_SEGMENT_KEYS.segmentAssetId]: z.string().regex(/^[1-9][0-9]*$/),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type VideoSceneSplitResult = z.infer<typeof videoSceneSplitResultSchema>;
export type VideoSceneSplitSegment = VideoSceneSplitResult["segments"][number];

/** 输入门槛常量（文档出处：官方 PDF「参考信息·使用限制与性能」表——「视频时长：单个视频
 *  时长不超过 2 小时」；消费方 = backend 创建入口复核 + web 按钮门槛预检〔两端判定与数值
 *  只此一份〕；时长数据缺失放行，由后端按权威数据复核〔规格故事 4〕，超限由创建入口
 *  拒绝或任务失败口径兜底）。 */
export const VIDEO_SCENE_SPLIT_MAX_DURATION_MS = 2 * 60 * 60 * 1000;
/** 格式面：官方支持 mp4 / flv / ts / avi / mov / wmv / mkv 等主流视频格式（文档「等主流
 *  视频格式」为开放式列举）——**不做格式预检白名单**（同 video-subtitle-erase /
 *  video-enhance 口径：我方上传面 video/* 全部在官方支持面内），故不设格式常量，本注释
 *  即格式面口径单源。 */

/** 执行面错误码归并口径（数值码注册在 error-codes.ts ERROR_VIDEO_SCENE_SPLIT_FAILED=1046，
 *  TS 侧常量单源在 error-codes.ts，本文件不重复定义——video-enhance / 去字幕同款）：
 *  三类映射——① 网关错误（HTTP 非 2xx / 成功态 error 信封 / 提交 SocketTimeout）复用既有
 *  通用码分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed 1011 / 提交超时
 *  provider_timeout 1012，NewApiErrorClassifier 同款，不新码）；② 火山任务失败（轮询
 *  status=failed，error 对象 code / message / param / type——TaskError / ApiError）与
 *  ③ 转存失败（result.segments[].segment_video_url 24h 临时链接 → 自家 TOS，任一段失败
 *  即整体失败）统一归并本工具兜底码 video_scene_split_failed（1046），无 worker 级自动
 *  重试，上游可读原因随 message 透传前端投影，用户手动重试沿用冻结 input。 */
