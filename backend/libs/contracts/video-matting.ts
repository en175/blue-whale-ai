import { z } from "zod";

/* 智能抠像（video_matting，火山 MediaKit 双端点人像/绿幕抠像）跨进程任务契约（IKHK7F）：
   父规格 IKHJRC（画布视频「智能抠像」工具：人像/绿幕双模式，WEBM 透明 / MP4 纯色，设计
   定案 ADR-0112）；术语见根 CONTEXT.md「画布视频智能抠像」。接口契约唯一权威 = 火山引擎
   AI MediaKit「智能处理·视频抠图」官方开发指南 PDF（本地开发指南
   智能处理_视频抠图_1785416185.pdf；提交 API 文档页 6448/2464608 人像、6448/2464612
   绿幕，查询 API 6448/2278532）——两个工具 API 独立、任务流程完全相同、共用同一个
   tasks 查询（PDF「工具说明」节原文；**异步任务**：提交返 task_id，轮询查询取
   result.video_url + result.resolution + result.duration，本仓经 new-api 网关调用；
   参数名以官方文档为准，出处逐条标注在常量注释，禁止引用二手信息）。
   跨进程字段在本文件定死后双端实现（红线：契约先行）：worker-java 侧同名常量类
   VideoMattingContract（domain/contract），防漂移断言见 video-matting.test.ts。
   双模式定死为模式枚举 + 端点映射：portrait（人像，任意视频识人）→ matte-portrait-video、
   greenscreen（绿幕/纯色背景素材，主体不限）→ matte-greenscreen-video，模式选择前置在
   入口下拉直选（ADR-0112），不进本文件提交参数（选择端点即选择模式）。
   结果回填约定：成功时 worker 轮询至 completed 后下载产物（官方 result.video_url 仅
   24h 有效）→ 落对象存储公开读 → 建产物 Asset → 终态 succeeded，video_url /
   resolution / duration 按本文件 result 契约跨进程回传，前端完成事件驱动移除任务占位卡、
   就地回填普通成品视频卡（一对一输出，ADR-0112）；失败时落 failed 与既有错误码投影
   （兜底 video_matting_failed，数值 1049——1048 已由音频截取占用），无 worker 级自动
   重试，用户在任务占位卡手动重试并沿用冻结 input。执行面（消费者、处理器、领取 SQL、
   终态收口）由 worker 票按附录 C 触点注册，创建入口行为由创建入口票承载。 */

/** 任务类型值：generation_jobs.type 与 RocketMQ tag 同值（沿用既有 tag=type 口径）；
 *  backend 入队用 queue.constants.ts 的 VIDEO_MATTING_TAG（与本常量恒等）。 */
export const VIDEO_MATTING_JOB_TYPE = "video_matting";

/** 任务来源值：智能抠像只有画布视频卡工具条「智能抠像 ▾」下拉（人像/绿幕两项直选）一个
 *  创建入口，claim SQL 的 source 白名单仅含本值（video_enhance / video_scene_split 的
 *  专属来源值同款模式）。 */
export const VIDEO_MATTING_SOURCE = "video_matting";

/** 抠像模式枚举（**本仓产品语义命名**，双模式与官方两个工具端点一一对应；文档出处：官方
 *  PDF「工具说明」节——人像抠图与绿幕抠图两工具）。模式选择前置到入口下拉直选，不跨会话
 *  记忆，每次发起重选（ADR-0112：换模式退出后重选，不提供就地互切）。 */
export const VIDEO_MATTING_MODES = ["portrait", "greenscreen"] as const;
export type VideoMattingMode = (typeof VIDEO_MATTING_MODES)[number];

/** 模式 → 网关异步提交路由映射（**双端点提交路径集中此一处**，worker 出站按模式取值）：
 *  对客 POST {VIDEO_MATTING_SUBMIT_PATHS[mode]}，网关按路径末段决定工具。火山上游侧对应
 *  官方文档「提交视频人像/绿幕抠图任务 API」逐字 POST /api/v1/tools/matte-portrait-video
 *  与 /api/v1/tools/matte-greenscreen-video，由网关内部转发，本仓不直连上游。
 *  ⚠️ 网关路径 ≠ 火山上游路径（IKH67T 实测：混用即 404 Invalid URL）；候选值按家族
 *  segment-scenes → /v1/mediakit/{tool} 规律推导——**最终以网关配置票 IKHK9O 定稿回填**，
 *  有出入只改本映射与对账测试（同 VIDEO_SCENE_SPLIT_SUBMIT_PATH 候选口径）。 */
export const VIDEO_MATTING_SUBMIT_PATHS: Record<VideoMattingMode, string> = {
  portrait: "/v1/mediakit/matte-portrait-video",
  greenscreen: "/v1/mediakit/matte-greenscreen-video",
};

/** 网关异步任务查询路由前缀（拼 taskId）：GET {前缀}{task_id}。MediaKit 异步工具家族
 *  （去字幕 / 视频 HD / 音视频分离 / 场景切分 / 抠像双端点）共用同一条查询路由，路径
 *  **不含 async 段**；查询窗口 30 天（官方 PDF 只演示 completed 态，status 枚举按家族
 *  口径 running / completed / failed，client 按 toLowerCase 归一容错解析——家族先例
 *  NewApiMediaKitSegmentScenesClient.poll 同款）。 */
export const VIDEO_MATTING_POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

/** 模式 → 对客模型名映射（网关按模型名路由 MediaKit 渠道并计次计费，抠像双端点网关配
 *  零价为上线前置）。候选值 mediakit-matte-portrait-video / mediakit-matte-greenscreen-video
 *  （双端点各自命名，是否合一由网关定）——**最终以网关配置票 IKHK9O 为准**，有出入只改
 *  本映射与对账测试（同 VIDEO_SCENE_SPLIT_MODEL_NAME 候选口径；本票把它升为契约常量，
 *  创建入口与 worker 出站统一引用，禁止另行发明字面量）。 */
export const VIDEO_MATTING_MODEL_NAMES: Record<VideoMattingMode, string> = {
  portrait: "mediakit-matte-portrait-video",
  greenscreen: "mediakit-matte-greenscreen-video",
};

/** 输出格式枚举（文档出处：官方 PDF「进阶使用·选择输出格式与背景颜色」节 format 参数，
 *  官方三选一 WEBM / MOV / MP4——本仓**只暴露两档、无 MOV**：透明 MOV 为 ProRes 4444
 *  编码，Chrome 无法预览，选了它的结果卡在画布上播不出来〔ADR-0112 否决项〕；面向
 *  AE/PR 的专业诉求出现后随时可加档）。WEBM = 透明背景（兼容好体积小），MP4 = 纯色
 *  背景（需 background_color）。 */
export const VIDEO_MATTING_FORMATS = ["WEBM", "MP4"] as const;
export type VideoMattingFormat = (typeof VIDEO_MATTING_FORMATS)[number];

/** 缺省输出格式 WEBM（产品口径「默认透明」= 官方 format 参数默认值同名同值）。创建
 *  请求体未传 format 时补本值后冻结（vocal_split output_format 同款口径；前端面板
 *  默认档与本同源——格式不跨会话记忆，每次进入编辑态重置为本值）。 */
export const VIDEO_MATTING_DEFAULT_FORMAT: VideoMattingFormat = "WEBM";

/** MP4 纯色背景色枚举（文档出处：官方 PDF format=MP4 时的 background_color 参数，可选
 *  black / white / green 三值）。 */
export const VIDEO_MATTING_BACKGROUND_COLORS = ["white", "black", "green"] as const;
export type VideoMattingBackgroundColor = (typeof VIDEO_MATTING_BACKGROUND_COLORS)[number];

/** 缺省背景色 white（**不采用官方默认**：官方两工具各异——绿幕抠图默认 black、人像抠图
 *  默认 green，为绿幕合成场景口径，与电商白底主流诉求相悖〔ADR-0112〕；且两工具默认
 *  不同，出站显式传防歧义）。仅 format=MP4 时有意义：创建请求体在 MP4 时未传
 *  background_color 补本值后冻结，WEBM（透明）不接受背景色（见提交 schema refine）。 */
export const VIDEO_MATTING_DEFAULT_BACKGROUND_COLOR: VideoMattingBackgroundColor = "white";

/** client_token 提交幂等键校验（≤64 可打印 ASCII、大小写敏感——本仓不做任何归一化，
 *  逐字节存储比对；写法沿用家族 video_scene_split 的 CLIENT_TOKEN_PATTERN 先例。
 *  注意：官方 PDF **未定义** client_token 参数，它是本仓 command_idempotency 幂等键
 *  （前端生成、每次发送与失败重试都新生成），出站请求不发）。 */
export const VIDEO_MATTING_CLIENT_TOKEN_PATTERN = /^[\x20-\x7E]{1,64}$/;

/** 提交参数键名（两模式共用同一组官方 body 参数；文档出处：官方 PDF 提交示例 +
 * 「进阶使用」节。模式不进提交参数——双端点已按模式分流，见 VIDEO_MATTING_SUBMIT_PATHS；
 *  画布创建入口的 input 冻结形态〔source_asset_id / target_node_id 等〕由创建入口票
 *  按家族先例在本文件扩展，IKH8BO 扩展同款）。 */
export const VIDEO_MATTING_SUBMIT_KEYS = {
  /** 待处理视频的公网可访问 URL（worker 出站前由源 Asset url 解析，Asset url 落库即
   *  public-read；官方参数，必填）。 */
  videoUrl: "video_url",
  /** 输出格式（见 VIDEO_MATTING_FORMATS；官方参数，缺省由创建侧补默认后冻结）。 */
  format: "format",
  /** MP4 纯色背景色（见 VIDEO_MATTING_BACKGROUND_COLORS；官方参数，仅 format=MP4 时
   *  有意义，出站显式传防两工具默认底色歧义）。 */
  backgroundColor: "background_color",
} as const;

/** 提交参数结构（strict 防多余键）。format / background_color 为**冻结后**形态：创建
 *  请求体里 format 可选（缺省补 VIDEO_MATTING_DEFAULT_FORMAT）、background_color 仅
 *  MP4 时可选（缺省补 VIDEO_MATTING_DEFAULT_BACKGROUND_COLOR），补默认后过本 schema
 *  （vocal_split 冻结后形态同款口径）；refine 收口两条：format=MP4 时 background_color
 *  必填、format=WEBM（透明）时不接受 background_color。client_token 见上方幂等键常量。
 *  官方 MOV 档不暴露：枚举外即拒（非法值在创建入口明确拒绝，不给隐式降档）。 */
export const videoMattingSubmitSchema = z
  .object({
    [VIDEO_MATTING_SUBMIT_KEYS.videoUrl]: z.string().min(1),
    [VIDEO_MATTING_SUBMIT_KEYS.format]: z.enum(VIDEO_MATTING_FORMATS),
    [VIDEO_MATTING_SUBMIT_KEYS.backgroundColor]: z
      .enum(VIDEO_MATTING_BACKGROUND_COLORS)
      .optional(),
    client_token: z.string().regex(VIDEO_MATTING_CLIENT_TOKEN_PATTERN),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.format === "MP4" && value.background_color == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "format 为 MP4（纯色背景）时 background_color 必填",
        path: ["background_color"],
      });
    }
    if (value.format === "WEBM" && value.background_color != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "format 为 WEBM（透明背景）时不接受 background_color",
        path: ["background_color"],
      });
    }
  });
export type VideoMattingSubmit = z.infer<typeof videoMattingSubmitSchema>;

/** result 冻结键名（跨进程结果契约——worker 写入、前端成品卡回填消费都用本组键；官方
 *  查询 result 的本仓跨进程形态：video_url 为**转存自有存储后的公开读产物地址**——官方
 *  result.video_url 是 24h 临时链接**不跨进程落库**（即收即转存 TOS，家族口径），
 *  resolution / duration 官方同名同值透传）。 */
export const VIDEO_MATTING_RESULT_KEYS = {
  /** 抠像结果产物地址（自有存储公开读 URL；worker 下载官方产物转存后回填，不得直连
   *  火山 24h 临时链接）。 */
  videoUrl: "video_url",
  /** 分辨率档位（官方 result.resolution，字符串如 "1080p"，同名同值透传）。 */
  resolution: "resolution",
  /** 视频时长（秒；官方 result.duration，同名同值透传）。 */
  duration: "duration",
} as const;

/** result 冻结结构（strict 防多余键；一对一单产物，无段列表扇出——区别于
 *  video_scene_split 的 segments 形态）。 */
export const videoMattingResultSchema = z
  .object({
    [VIDEO_MATTING_RESULT_KEYS.videoUrl]: z.string().min(1),
    [VIDEO_MATTING_RESULT_KEYS.resolution]: z.string().min(1),
    [VIDEO_MATTING_RESULT_KEYS.duration]: z.number().nonnegative(),
  })
  .strict();
export type VideoMattingResult = z.infer<typeof videoMattingResultSchema>;

/** 使用限制口径（文档出处：官方 PDF「参考信息」表——支持 mp4 / flv / ts / avi / mov /
 *  mkv / wmv 等主流视频格式〔开放式列举〕，建议单输入 ≤10 GB，处理耗时通常为视频时长
 *  1~3 倍）：不做格式预检白名单与大小预检（家族 video_scene_split / video_subtitle_erase
 *  同款——我方上传面 video/* 全部在官方支持面内，家族先例均未加大小预检），不设格式/
 *  大小常量，本注释即口径单源；时长门槛（对齐去字幕 10 分钟置灰）与 worker 轮询窗口
 *  上限由创建入口票 / worker 票按 ADR-0112 定值（处理耗时 1~3 倍口径下须保证轮询
 *  窗口覆盖）。 */

/** 执行面错误码归并口径（数值码注册在 error-codes.ts ERROR_VIDEO_MATTING_FAILED=1049，
 *  TS 侧常量单源在 error-codes.ts，本文件不重复定义——video_scene_split / video-enhance
 *  同款）：三类映射——① 网关错误（HTTP 非 2xx / 成功态 error 信封 / 提交 SocketTimeout）
 *  复用既有通用码分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed 1011 /
 *  提交超时 provider_timeout 1012，NewApiErrorClassifier 同款，不新码；本 PDF 未含错误
 *  对象节，错误信封口径 = 家族先例而非本 PDF）；② 火山任务失败（轮询 status=failed，
 *  error 对象 code / message / param / type——TaskError / ApiError）与 ③ 转存失败
 *  （result.video_url 24h 临时链接 → 自家 TOS 失败）统一归并本工具兜底码
 *  video_matting_failed（1049，双模式共享一码、错误信息透传区分——segment-scenes 单码
 *  家族口径），无 worker 级自动重试，上游可读原因随 message 透传前端投影，用户手动
 *  重试沿用冻结 input。 */
