import { z } from "zod";

/* 视频智能去字幕（video_subtitle_erase）跨进程任务契约（IKGZ7Z）：
   权威章节 = docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md §17（冻结增量）；
   需求规格 = docs/specs/2026-09-19-video-subtitle-erase-mediakit.md；术语见根 GLOSSARY.md
   「画布视频智能去字幕」。接口契约唯一权威 = 火山引擎 AI MediaKit「提交字幕擦除（精细化版）
   任务 API」官方 PDF POST https://mediakit.cn-beijing.volces.com/api/v1/tools/erase-video-subtitle-pro
   （**异步任务**：提交返 task_id，轮询查询取结果——家族内首个异步工具，区别于高清/擦除/抠图的
   同步路由；本仓经 new-api 网关调用，对客模型名 mediakit-erase-video-subtitle-pro；
   参数名以官方 PDF 为准，出处逐条标注在常量注释）。
   跨进程字段在本文件定死后双端实现（红线：契约先行）：worker-java 侧同名常量类
   VideoSubtitleEraseContract（domain/entity），防漂移断言见 video-subtitle-erase.test.ts。
   结果回填约定（§17.5）：成功时 worker 轮询至 completed 后立即下载结果视频（火山 URL 仅
   24h 有效）→ 落对象存储公开读 → 建 Asset（type=video / source='generated' /
   generation_job_id）→ 终态 succeeded，前端经 GET /api/jobs/:id 的 asset 按 target_node_id
   回填去字幕结果卡（源卡不动，结果卡可再次去字幕）；失败时落 failed 与既有错误码投影
   （兜底 video_subtitle_erase_failed，数值 1043——1039-1042 已由高清/擦除/扩图/抠图占用），
   无 worker 级自动重试，用户在结果卡手动重试并沿用冻结 input。 */

/** 任务类型值：generation_jobs.type 与 RocketMQ tag 同值（沿用既有 tag=type 口径）；
 *  backend 入队用 queue.constants.ts 的 VIDEO_SUBTITLE_ERASE_TAG（与本常量恒等）。 */
export const VIDEO_SUBTITLE_ERASE_JOB_TYPE = "video_subtitle_erase";

/** 任务来源值：去字幕只有画布视频卡工具条「智能去字幕」一个创建入口，claim SQL 的
 *  source 白名单仅含本值（image_erase / image_cutout 的专属来源值同款模式）。 */
export const VIDEO_SUBTITLE_ERASE_SOURCE = "video_subtitle_erase";

export const VIDEO_SUBTITLE_ERASE_INPUT_KEYS = {
  /** 源素材身份（被去字幕的视频 Asset id；命名沿用 media_extract 的 source_asset_id）。 */
  sourceAssetId: "source_asset_id",
  /** 目标节点身份（画布去字幕结果卡 node id，前端回填结果时定位用；去字幕是发送时才建卡，
   *  node id 由前端生成传入，worker 不消费画布拓扑）。 */
  targetNodeId: "target_node_id",
  /** 检测模式（见 VIDEO_SUBTITLE_ERASE_DETECT_MODES；本仓产品语义值，出站映射官方
   *  mode 参数——见 VIDEO_SUBTITLE_ERASE_MODE 映射表）。 */
  detectMode: "detect_mode",
  /** 归一化框列表（见 VIDEO_SUBTITLE_ERASE_BOX_KEYS；空数组 = 不拉框走智能默认，
   *  出站不传 erase_ratio_location 键；非空出站映射官方 erase_ratio_location 数组）。 */
  eraseBoxes: "erase_boxes",
} as const;

/** 擦除框内 Location 对象键名（文档出处：官方 PDF「Location 对象」节——归一化坐标系，
 *  画面左上角为原点 (0,0)、右下角为 (1,1)，左上/右下两顶点确定矩形；出站原样透传）。 */
export const VIDEO_SUBTITLE_ERASE_BOX_KEYS = {
  topLeftX: "top_left_x",
  topLeftY: "top_left_y",
  bottomRightX: "bottom_right_x",
  bottomRightY: "bottom_right_y",
} as const;

/** 检测模式枚举（本期两值；**本仓产品语义命名，非官方参数值**——官方 mode 取值
 *  Subtitle / Text 首字母大写，出站经 VIDEO_SUBTITLE_ERASE_MODE 映射，文档出处：
 *  官方 PDF Body 参数 mode 节）。
 *  - subtitle_smart：智能字幕模式（映射官方 Subtitle）。OCR 检测为字幕的文本，默认仅
 *    处理画面下半部分（下方 50%）区域；配置擦除框后实际生效区域 = 框与下半区域的交集。
 *    官方默认擦除边界：下半 Y≥0.5、水平居中、文字高度 1%~10%、白色、中英。
 *  - text_full：全画面文字模式（映射官方 Text）。擦除 OCR 检测为字幕及其他类型文本
 *    （如人名、地名等），不含场景文字（如牌匾），对整个画面做文本检测；这也是擦顶部
 *    字幕的途径；配置擦除框后仅在框内执行擦除。 */
export const VIDEO_SUBTITLE_ERASE_DETECT_MODES = ["subtitle_smart", "text_full"] as const;
export type VideoSubtitleEraseDetectMode = (typeof VIDEO_SUBTITLE_ERASE_DETECT_MODES)[number];

/** 检测模式 → 官方 mode 参数映射（单处定义，worker 出站请求处换算；文档出处：官方 PDF
 *  Body 参数 mode 节——Subtitle 为默认值、Text 为全画面文本检测）。 */
export const VIDEO_SUBTITLE_ERASE_MODE: Record<VideoSubtitleEraseDetectMode, string> = {
  subtitle_smart: "Subtitle",
  text_full: "Text",
};

/** 擦除框数量上限（文档出处：官方 PDF erase_ratio_location 参数节「最多支持 20 个擦除框」；
 *  前端编辑态拉满提示与创建入口复核同源）。 */
export const VIDEO_SUBTITLE_ERASE_MAX_BOXES = 20;

/** 出站固定参数（单处定义，worker 出站请求处引用；两者均为服务端常量、不从前端传入——
 *  规格 Implementation Decisions「算法版本选择（固定 v5）与输出编码选择（固定 Quality）」
 *  属 Out of Scope）。
 *  model_version 固定 v5（文档出处：官方 PDF Body 参数 model_version 节——默认 v4；v5 相比
 *  V4 优化 AIGC 生成视频擦除字幕后的闪烁问题与带阴影字幕的擦除效果，优化误擦问题，并提升
 *  处理速度）。 */
export const VIDEO_SUBTITLE_ERASE_MODEL_VERSION = "v5";
/** output_encode_mode 固定 Quality（文档出处：官方 PDF Body 参数 output_encode_mode 节——
 *  默认 Quality 画质优先、较高码率编码；Size 大小优先为范围外）。 */
export const VIDEO_SUBTITLE_ERASE_OUTPUT_ENCODE_MODE = "Quality";

/** input 冻结结构（创建入口复核与重试沿用都用本 schema；strict 防多余键）。
 *  四键恒在（detect_mode 与有无框独立组合：无框+subtitle_smart=智能模式走官方默认行为，
 *  有框=按框擦，text_full 扩大检测范围——一个发送动作统一两种语义，规格故事 17/18/12）。
 *  本期不实现 time_segment_filter（分时间段擦除为 Out of Scope），strict 分支无此键、
 *  传入即拒；结构扩展位见下方 VideoSubtitleEraseTimeSegmentFilter 注释。 */
export const videoSubtitleEraseInputSchema = z
  .object({
    [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.detectMode]: z.enum(VIDEO_SUBTITLE_ERASE_DETECT_MODES),
    [VIDEO_SUBTITLE_ERASE_INPUT_KEYS.eraseBoxes]: z
      .array(
        z
          .object({
            [VIDEO_SUBTITLE_ERASE_BOX_KEYS.topLeftX]: z.number().min(0).max(1),
            [VIDEO_SUBTITLE_ERASE_BOX_KEYS.topLeftY]: z.number().min(0).max(1),
            [VIDEO_SUBTITLE_ERASE_BOX_KEYS.bottomRightX]: z.number().min(0).max(1),
            [VIDEO_SUBTITLE_ERASE_BOX_KEYS.bottomRightY]: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(VIDEO_SUBTITLE_ERASE_MAX_BOXES),
  })
  .strict();
export type VideoSubtitleEraseInput = z.infer<typeof videoSubtitleEraseInputSchema>;
export type VideoSubtitleEraseEraseBox = VideoSubtitleEraseInput["erase_boxes"][number];

/** time_segment_filter 结构扩展位（本期不实现，仅留位——规格 Out of Scope「分时间段擦除：
 *  skip/selected 模式与分时段独立框；契约留结构扩展位，后续单独立项」）。官方结构
 *  （文档出处：官方 PDF「Time segment filter 对象」+「Segment 对象」节）：
 *  { mode: "skip" | "selected", segments: [{ start_time: 秒(≥0), end_time: 秒(>start_time),
 *    erase_ratio_location?: Location[]（每段最多 20 框，仅 selected 支持） }] }——skip = 跳过
 *  segments 时间段对其余部分擦除，selected = 仅对 segments 时间段擦除；segments[].erase_ratio_location
 *  （分时段独立擦除框）与顶层 erase_ratio_location（全局擦除框）互斥，不能同请求配置。
 *  实现票接入时在本类型与 schema 同步落 zod 分支，禁止另起字段名。 */
export interface VideoSubtitleEraseTimeSegmentFilter {
  mode: "skip" | "selected";
  segments: {
    start_time: number;
    end_time: number;
    erase_ratio_location?: VideoSubtitleEraseEraseBox[];
  }[];
}

/** 输入限制常量（文档出处：官方 PDF video_url 参数「支持格式 / 输入分辨率限制」节 +
 *  产品口径；消费方 = backend 创建入口复核 + web 按钮门槛预检（两端判定与数值只此一份）；
 *  worker-java 不做门槛复核——宽高/时长缺失的存量放行，交供应商按官方门槛拒）。
 *  官方分辨率限制仅一句「最高支持 2K 分辨率」无像素值；2K 像素判定按工单预授权沿用图片系
 *  先例（IKGOSZ 修正后口径，竖屏合法）：短边 ≤1440px、长边 ≤2560px（取宽高较大者为长边）。
 *  null（宽/高/时长缺失）放行不误拦（规格故事 5）。 */
export const VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX = 1440;
export const VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX = 2560;
/** 时长上限：10 分钟**产品上限**（官方 API 无视频时长上限，规格故事 4 产品口径）；
 *  duration_ms 缺失放行。 */
export const VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS = 10 * 60 * 1000;
/** 格式面：官方支持 mp4 / flv / ts / avi / mov / wmv / mkv 等主流格式（文档「等主流视频
 *  格式」为开放式列举）——**不做格式预检白名单**（规格 Implementation Decisions：我方上传面
 *  video/* 全部在官方支持面内），故不设格式常量，本注释即格式面口径单源。 */

/** 去字幕来源边标记（写在 edge.data.origin，模式同 image-cutout.ts 的 IMAGE_CUTOUT_EDGE_ORIGIN，
 *  常量单源到本契约）：这条边表达「去字幕结果卡由该视频去字幕而来」，是来源记录而非生成
 *  参考输入——媒体引用推导会跳过带此标记的边，源视频不占参考位、不参与 @ 编号与媒体索引
 *  （规格故事 20）。 */
export const VIDEO_SUBTITLE_ERASE_EDGE_ORIGIN = "video-subtitle-erase";
