import { z } from "zod";

/* 图片擦除（image_erase）跨进程任务契约（IKGOT3）：
   权威章节 = docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md §15（冻结增量）；
   需求规格 = docs/specs/2026-09-18-image-erase-mediakit.md；术语见根 CONTEXT.md「画布图片擦除」。
   供应商接口 = 火山引擎 AI MediaKit「提交图像擦除修复任务 API」
   POST https://mediakit.cn-beijing.volces.com/api/v1/tools-sync/erase-image
   （本仓经 new-api 网关调用，路径模式同高清放大；参数名以官方 PDF 为准，出处逐条标注在常量注释）。
   跨进程字段在本文件定死后双端实现（红线：契约先行）：worker-java 侧同名常量类
   ImageEraseContract（domain/entity），防漂移断言见 image-erase.test.ts。
   结果回填约定（§15.5）：成功时 worker 下载结果图（火山 URL 仅 24h 有效）→ 落对象存储公开读
   → 建 Asset（type=image / source='generated' / generation_job_id）→ 终态 succeeded，
   前端经 GET /api/jobs/:id 的 asset 按 target_node_id 回填擦除结果卡（源卡不动）；
   失败时落 failed 与既有错误码投影（兜底 image_erase_failed），无自动重试，用户在结果卡手动重试
   并沿用冻结 input。 */

/** 任务类型值：generation_jobs.type 与 RocketMQ tag 同值（沿用既有五类 tag=type 口径）；
 *  backend 入队用 queue.constants.ts 的 IMAGE_ERASE_TAG（与本常量恒等）。 */
export const IMAGE_ERASE_JOB_TYPE = "image_erase";

/** 任务来源值：擦除只有画布图片卡工具条一个创建入口，claim SQL 的 source 白名单仅含本值
 *  （image_enhance 的 source="image_enhance" 同款「专属来源值」模式）。 */
export const IMAGE_ERASE_SOURCE = "image_erase";

/** input 冻结键名（四业务键按场景恒在、值恒为合法枚举，创建时定死，重试原样沿用）。
 *  基础设施键 provider_credential 在四键之上由创建侧冻结落库（同 image_enhance 先例，
 *  不进本 zod——它校验的是客户端 payload，凭证来自请求头经 sealProviderCredential 密封）。 */
export const IMAGE_ERASE_INPUT_KEYS = {
  /** 源素材身份（被擦除的图片 Asset id；命名沿用 media_extract 的 source_asset_id）。 */
  sourceAssetId: "source_asset_id",
  /** 目标节点身份（画布擦除结果卡 node id，前端回填结果时定位用；擦除是发送时才建卡，
   *  node id 由前端生成传入，worker 不消费画布拓扑）。 */
  targetNodeId: "target_node_id",
  /** 擦除场景（见 IMAGE_ERASE_SCENES；与火山 API 参数 standard_scene 的取值同名同值）。 */
  eraseScene: "erase_scene",
  /** 遮罩素材身份（黑白遮罩 Asset id；selected_area_erase 必填、full_screen_text_erase 禁填，
   *  由 schema 分支强制）。 */
  maskAssetId: "mask_asset_id",
} as const;

/** 擦除场景枚举（本期两值；与火山 API 参数 standard_scene 取值同名同值，文档出处：官方 PDF
 *  Body 参数 standard_scene 节）。full_screen_icon_erase / standard_erase_text 为范围外
 *  （规格 Out of Scope），枚举可扩展、不预写值。
 *  - full_screen_text_erase：全屏文字擦除（文档默认场景），不传遮罩与指定文字，擦所有文字。
 *  - selected_area_erase：指定区域擦除，只传 mask_url（统一遮罩路径，支持多框多笔并集），
 *    不传 selected_area 矩形（文档允许两者并传擦并集，本仓不依赖）。 */
export const IMAGE_ERASE_SCENES = ["full_screen_text_erase", "selected_area_erase"] as const;
export type ImageEraseScene = (typeof IMAGE_ERASE_SCENES)[number];

/** 火山 MediaKit tool_version：文档明示「当前仅支持 standard（标准版）」，无档位可选（区别于
 *  高清放大的三档映射），worker 出站固定传本值。 */
export const IMAGE_ERASE_TOOL_VERSION = "standard";

/** 输出格式固定 png（文档：output_format 可选 webp(默认)/png/jpeg；取 png 保证结果卡可二次
 *  擦除、扩图、高清放大——webp 不在擦除输入格式白名单内）。 */
export const IMAGE_ERASE_OUTPUT_FORMAT = "png";

/** 输入限制常量（文档出处：官方 PDF image_url 参数「图像输入分辨率 / 文件大小 / 支持格式」节；
 *  消费方 = backend 创建入口复核 + web 菜单门槛预检（两端判定与数值只此一份）；
 *  worker-java 不消费——宽高缺失的存量图放行，交供应商按官方门槛拒）。
 *  分辨率上限：不得超过 2560x1440 像素（宽x高）。 */
export const IMAGE_ERASE_MAX_WIDTH_PX = 2560;
export const IMAGE_ERASE_MAX_HEIGHT_PX = 1440;
/** 分辨率下限：不得小于 10x10 像素（文档有下限，同样写入常量防两端漂移）。 */
export const IMAGE_ERASE_MIN_SIDE_PX = 10;
/** 文件大小上限：单张图片不得超过 10 MB。 */
export const IMAGE_ERASE_MAX_FILE_BYTES = 10 * 1024 * 1024;
/** 支持格式白名单：.png / .jpg / .jpeg / .heic（不含 webp/gif，前端门槛置灰与后端复核同源）。 */
export const IMAGE_ERASE_INPUT_FORMATS = ["png", "jpg", "jpeg", "heic"] as const;

/** 遮罩中间素材的 assets.source 标记（IKGOTB）：涂抹遮罩经通用上传链路落库时以此来源值标记，
 *  用户资产列表（GET /api/assets → listByUser）排除该来源——黑白遮罩不是用户创作内容，
 *  不进资产列表可见内容（规格 Further Notes「遮罩中间素材不进入用户资产列表的可见内容」）。
 *  资产行本身保留（不软删）：任务创建入口的归属校验、worker 的遮罩解析、失败重试
 *  （沿用冻结 input 的 mask_asset_id）都要求遮罩资产一直可读；仅列表不可见。
 *  上传链路（uploads/complete）对 source 做白名单校验（uploaded / mask_erase），
 *  非白名单值回落 uploaded——source 只是展示过滤维度，无鉴权语义。 */
export const IMAGE_ERASE_MASK_ASSET_SOURCE = "mask_erase";

/** input 冻结结构（IKGOT4 创建入口复核与重试沿用都用本 schema；strict 防多余键）。
 *  按场景二选一（discriminatedUnion on erase_scene）：
 *  - full_screen_text_erase：三键，禁填 mask_asset_id（strict 分支无此键，传入即拒）；
 *  - selected_area_erase：四键，mask_asset_id 必填（Asset id 数字串）。 */
const fullScreenTextEraseInputSchema = z
  .object({
    [IMAGE_ERASE_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [IMAGE_ERASE_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [IMAGE_ERASE_INPUT_KEYS.eraseScene]: z.literal("full_screen_text_erase"),
  })
  .strict();

const selectedAreaEraseInputSchema = z
  .object({
    [IMAGE_ERASE_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [IMAGE_ERASE_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [IMAGE_ERASE_INPUT_KEYS.eraseScene]: z.literal("selected_area_erase"),
    [IMAGE_ERASE_INPUT_KEYS.maskAssetId]: z.string().regex(/^[1-9][0-9]*$/),
  })
  .strict();

export const imageEraseInputSchema = z.discriminatedUnion(
  IMAGE_ERASE_INPUT_KEYS.eraseScene,
  [fullScreenTextEraseInputSchema, selectedAreaEraseInputSchema],
);
export type ImageEraseInput = z.infer<typeof imageEraseInputSchema>;
