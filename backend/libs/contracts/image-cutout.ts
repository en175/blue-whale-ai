import { z } from "zod";

/* 图片抠图（image_cutout）跨进程任务契约（IKGXLS）：
   权威章节 = docs/specs/2026-09-18-image-cutout-mediakit.md（官方 API 要点 + Implementation
   Decisions）；接口契约唯一权威 = 火山引擎 AI MediaKit「提交图像背景移除任务 API」官方 PDF
   POST https://mediakit.cn-beijing.volces.com/api/v1/tools-sync/remove-image-background
   （同步接口；本仓经 new-api 网关调用，对客模型名 mediakit-remove-image-background；
   参数名以官方 PDF 为准，出处逐条标注在常量注释）；术语见根 CONTEXT.md「画布图片抠图」。
   跨进程字段在本文件定死后双端实现（红线：契约先行）：worker-java 侧同名常量类
   ImageCutoutContract（domain/entity），防漂移断言见 image-cutout.test.ts。
   结果回填约定（同擦除 §15.5 模式）：成功时 worker 在同步响应后立即下载结果图（火山 URL
   仅 24h 有效）→ 落对象存储公开读 → 建 Asset（type=image / source='generated' /
   generation_job_id）→ 终态 succeeded，前端经 GET /api/jobs/:id 的 asset 按 target_node_id
   回填抠图结果卡（源卡不动，透明 png 垫棋盘格底纹）；失败时落 failed 与既有错误码投影
   （兜底 image_cutout_failed，数值 1041），无自动重试，用户在结果卡手动重试并沿用冻结 input。
   供应商响应形状（官方 PDF 响应节）：success/result/error/task_id/task_type/request_id/
   expires_at/queue_id，result 含 image_url（24h 有效）/image_size/image_format/image_width/
   image_height——worker 消费（下载转存建素材），不进本契约冻结结构。 */

/** 任务类型值：generation_jobs.type 与 RocketMQ tag 同值（沿用既有 tag=type 口径）；
 *  backend 入队用 queue.constants.ts 的 IMAGE_CUTOUT_TAG（与本常量恒等）。 */
export const IMAGE_CUTOUT_JOB_TYPE = "image_cutout";

/** 任务来源值：抠图只有画布图片卡工具条「高清 ▾ → 抠图」一个创建入口，claim SQL 的
 *  source 白名单仅含本值（image_erase 的 source="image_erase" 同款「专属来源值」模式）。 */
export const IMAGE_CUTOUT_SOURCE = "image_cutout";

/** input 冻结键名（业务键按场景三键/七键恒在、值恒为合法枚举，创建时定死，重试原样沿用）。
 *  基础设施键 provider_credential 在业务键之上由创建侧冻结落库（同 image_erase 先例，
 *  不进本 zod——它校验的是客户端 payload，凭证来自请求头经 sealProviderCredential 密封）。 */
export const IMAGE_CUTOUT_INPUT_KEYS = {
  /** 源素材身份（被抠图的图片 Asset id；命名沿用 media_extract 的 source_asset_id）。 */
  sourceAssetId: "source_asset_id",
  /** 目标节点身份（画布抠图结果卡 node id，前端回填结果时定位用；抠图是发送时才建卡，
   *  node id 由前端生成传入，worker 不消费画布拓扑）。 */
  targetNodeId: "target_node_id",
  /** 抠图场景（见 IMAGE_CUTOUT_SCENES；与火山 API 参数 scene 的取值同名同值）。 */
  cutoutScene: "cutout_scene",
  /** 主体描边开关（仅 human|product 场景携带；官方在 general 场景忽略描边与裁剪参数）。 */
  needContour: "need_contour",
  /** 描边颜色（仅 human|product 携带；固定白色，取色器为范围外）。 */
  contourColor: "contour_color",
  /** 描边宽度 px（仅 human|product 携带；[1,100] 默认 10）。 */
  contourSize: "contour_size",
  /** 透明背景裁剪开关（仅 human|product 场景携带）。 */
  needCropBackground: "need_crop_background",
} as const;

/** 抠图场景枚举（本期三值；与火山 API 参数 scene 取值同名同值，文档出处：官方 PDF
 *  Body 参数 scene 节）。
 *  - general：通用场景，自动识别并保留图像主体（期望抠出主体但不确定分类时用）。
 *  - human：人像抠图，仅保留图像中的人像主体。
 *  - product：商品抠图，仅保留图像中的商品主体。 */
export const IMAGE_CUTOUT_SCENES = ["general", "human", "product"] as const;
export type ImageCutoutScene = (typeof IMAGE_CUTOUT_SCENES)[number];

/** 出站固定参数（单处定义，worker 出站请求处引用）：output_format 固定 png（官方：png
 *  默认支持透明 / jpeg 透明填黑 / webp 下游不兼容，后两者被规格 Out of Scope 否决；
 *  png 保证结果卡可二次擦除、高清放大、再抠图）。官方另有 queue_id 可选参（按队列分账用），
 *  本功能不传——走系统默认队列（规格 Implementation Decisions「queue_id 不传」）。 */
export const IMAGE_CUTOUT_OUTPUT_FORMAT = "png";

/** 描边颜色固定 #FFFFFF（官方默认值；产品口径颜色不可选，取色器为范围外——见规格
 *  Implementation Decisions「contour_color 固定 #FFFFFF」）。 */
export const IMAGE_CUTOUT_CONTOUR_COLOR = "#FFFFFF";

/** 描边宽度取值（官方 PDF contour_size 节：取值范围 [1,100]，默认 10）。
 *  产品对客滑杆 1~50（规格故事 11）属前端展示口径，出站钳制在 web 侧 imageCutout 模块做，
 *  本契约按官方口径 [1,100] 冻结。 */
export const IMAGE_CUTOUT_CONTOUR_SIZE_MIN = 1;
export const IMAGE_CUTOUT_CONTOUR_SIZE_MAX = 100;
export const IMAGE_CUTOUT_CONTOUR_SIZE_DEFAULT = 10;

/** 输入限制常量（文档出处：官方 PDF image_url 参数「图像来源 / 文件大小 / 图像输入分辨率」节；
 *  消费方 = backend 创建入口复核 + web 菜单门槛预检（两端判定与数值只此一份）；
 *  worker-java 不消费——宽高缺失的存量图放行，交供应商按官方门槛拒）。
 *  分辨率上限按场景两档（见 IMAGE_CUTOUT_SCENE_SIZE_LIMITS）；官方无分辨率下限，不设下限。 */
/** 文件大小上限：单张图片不得超过 30 MB。 */
export const IMAGE_CUTOUT_MAX_FILE_BYTES = 30 * 1024 * 1024;
/** 支持格式白名单：.png / .jpg / .jpeg / .heic（不含 webp/gif，前端门槛置灰与后端复核同源）。 */
export const IMAGE_CUTOUT_INPUT_FORMATS = ["png", "jpg", "jpeg", "heic"] as const;

/** 场景 → 分辨率上限矩阵（单处定义，文档出处：官方 PDF image_url 参数「图像输入分辨率」节）：
 *  - general 档：长边 ≤10240px、短边 ≤6000px、总像素（长边×短边）≤40MP（菜单预检也用本档）；
 *  - human|product 档：长边 ≤7680px、短边 ≤4320px（官方未给该档总像素上限，不设）。
 *  消费方 = backend 创建入口按所传场景复核 + web 发送前按所选场景精校（规格故事 4/15：
 *  菜单预检用 general 档，切人像/商品后按本档精校更严上限）。 */
export const IMAGE_CUTOUT_SCENE_SIZE_LIMITS: Record<
  ImageCutoutScene,
  {
    /** 长边上限（px；长边 = max(width, height)，竖图横图同口径）。 */
    maxLongSide: number;
    /** 短边上限（px；短边 = min(width, height)）。 */
    maxShortSide: number;
    /** 总像素上限（长边×短边；仅 general 档官方给出 40MP，其余档缺省不限）。 */
    maxTotalPixels?: number;
  }
> = {
  general: {
    maxLongSide: 10240,
    maxShortSide: 6000,
    maxTotalPixels: 40 * 1000 * 1000,
  },
  human: {
    maxLongSide: 7680,
    maxShortSide: 4320,
  },
  product: {
    maxLongSide: 7680,
    maxShortSide: 4320,
  },
};

/** 抠图来源边标记（写在 edge.data.origin，模式同 imageErase.ts 的 IMAGE_ERASE_EDGE_ORIGIN，
 *  常量单源到本契约）：这条边表达「抠图结果卡由该图抠图而来」，是来源记录而非生成参考
 *  输入——图片参考推导会跳过带此标记的边（mediaRefs.ts 纯视觉白名单），源图不占参考位、
 *  不参与 @ 编号与媒体索引（规格故事 19）。 */
export const IMAGE_CUTOUT_EDGE_ORIGIN = "image-cutout";

/** input 冻结结构（创建入口复核与重试沿用都用本 schema；strict 防多余键）。
 *  组装规则（规格故事 29 / Implementation Decisions）：通用场景不携带描边与裁剪参数——
 *  官方在 general 场景会忽略 need_contour / contour_color / contour_size / need_crop_background
 *  四参，前端请求体不得携带接口会忽略的字段，strict 分支无此四键、传入即拒；
 *  human|product 场景四键恒在（need_contour=false 时官方忽略 contour_color/contour_size，
 *  仍随请求携带，与「四者仅人像/商品场景随请求携带」的规格口径一致）。 */
const generalSceneInputSchema = z
  .object({
    [IMAGE_CUTOUT_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [IMAGE_CUTOUT_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [IMAGE_CUTOUT_INPUT_KEYS.cutoutScene]: z.literal("general"),
  })
  .strict();

const subjectSceneInputSchema = (scene: "human" | "product") =>
  z
    .object({
      [IMAGE_CUTOUT_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
      [IMAGE_CUTOUT_INPUT_KEYS.targetNodeId]: z.string().min(1),
      [IMAGE_CUTOUT_INPUT_KEYS.cutoutScene]: z.literal(scene),
      [IMAGE_CUTOUT_INPUT_KEYS.needContour]: z.boolean(),
      [IMAGE_CUTOUT_INPUT_KEYS.contourColor]: z.literal(IMAGE_CUTOUT_CONTOUR_COLOR),
      [IMAGE_CUTOUT_INPUT_KEYS.contourSize]: z
        .number()
        .int()
        .min(IMAGE_CUTOUT_CONTOUR_SIZE_MIN)
        .max(IMAGE_CUTOUT_CONTOUR_SIZE_MAX),
      [IMAGE_CUTOUT_INPUT_KEYS.needCropBackground]: z.boolean(),
    })
    .strict();

export const imageCutoutInputSchema = z.discriminatedUnion(
  IMAGE_CUTOUT_INPUT_KEYS.cutoutScene,
  [generalSceneInputSchema, subjectSceneInputSchema("human"), subjectSceneInputSchema("product")],
);
export type ImageCutoutInput = z.infer<typeof imageCutoutInputSchema>;
