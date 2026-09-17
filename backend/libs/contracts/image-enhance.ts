import { z } from "zod";

/* 高清放大（image_enhance）跨进程任务契约（IKGM8U）：
   权威章节 = docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md §14（冻结增量）；
   需求规格 = docs/specs/2026-09-17-image-upscale-mediakit.md；术语见根 CONTEXT.md「画布高清放大」。
   跨进程字段在本文件定死后双端实现（红线：契约先行）：worker-java 侧同名常量类
   ImageEnhanceContract（domain/entity），防漂移断言见 image-enhance.test.ts。
   结果回填约定（§14.5）：成功时 worker 下载结果图（火山 URL 仅 24h 有效）→ 落对象存储公开读
   → 建 Asset（type=image / source='generated' / generation_job_id）→ 终态 succeeded，
   前端经 GET /api/jobs/:id 的 asset 按 target_node_id 回填目标高清卡（源卡不动）；
   失败时落 failed 与既有错误码投影（兜底 image_enhance_failed），无自动重试，用户在原卡手动重试
   并沿用冻结 input。 */

/** 任务类型值：generation_jobs.type 与 RocketMQ tag 同值（沿用既有四类 tag=type 口径）；
 *  backend 入队用 queue.constants.ts 的 IMAGE_ENHANCE_TAG（与本常量恒等）。 */
export const IMAGE_ENHANCE_JOB_TYPE = "image_enhance";

/** 任务来源值：高清放大只有画布图片卡工具条一个创建入口，claim SQL 的 source 白名单仅含本值
 *  （media_extract 的 source="dock" 同款「专属来源值」模式）。 */
export const IMAGE_ENHANCE_SOURCE = "image_enhance";

/** input 冻结键名（六键恒在、值恒为合法枚举，创建时定死，重试原样沿用）。
 *  版本不支持的字段不缺省、不剥键——worker 出站时按 IMAGE_ENHANCE_TIER_CAPABILITY 裁剪。 */
export const IMAGE_ENHANCE_INPUT_KEYS = {
  /** 源素材身份（被放大的图片 Asset id；命名沿用 media_extract 的 source_asset_id）。 */
  sourceAssetId: "source_asset_id",
  /** 目标节点身份（画布高清卡 node id，前端回填结果时定位用；worker 不消费画布拓扑）。 */
  targetNodeId: "target_node_id",
  /** 版本档（lite/pro/max，见 IMAGE_ENHANCE_VERSION_TIERS）。 */
  versionTier: "version_tier",
  /** 放大倍数（与火山 API 参数 multiple 同名同值，worker 原样透传）。 */
  multiple: "multiple",
  /** 增强策略（与火山 API 参数 generative_enhance_mode 同名同值）。 */
  generativeEnhanceMode: "generative_enhance_mode",
  /** 色彩校正开关（与火山 API 参数 enable_correct_color 同名同值）。 */
  enableCorrectColor: "enable_correct_color",
} as const;

/** 版本档枚举值（input 冻结值）。前端展示名 Lite / Pro / Max 只存在于 UI，不落库不进任务。 */
export const IMAGE_ENHANCE_VERSION_TIERS = ["lite", "pro", "max"] as const;
export type ImageEnhanceVersionTier = (typeof IMAGE_ENHANCE_VERSION_TIERS)[number];

/** 版本档 → 火山 MediaKit tool_version 映射（单处定义；worker 出站请求处换算）：
 *  lite→standard、pro→professional、max→max。默认档 pro。 */
export const IMAGE_ENHANCE_TOOL_VERSION: Record<ImageEnhanceVersionTier, string> = {
  lite: "standard",
  pro: "professional",
  max: "max",
};

/** 放大倍数合法值（规格限 2/4/6，不开放 1~30 任意倍率）。 */
export const IMAGE_ENHANCE_MULTIPLES = [2, 4, 6] as const;

/** 增强策略枚举值（fidelity_first=保真度优先 / generative_first=生成度优先）。 */
export const IMAGE_ENHANCE_MODES = ["fidelity_first", "generative_first"] as const;
export type ImageEnhanceMode = (typeof IMAGE_ENHANCE_MODES)[number];

/** 版本档能力矩阵（对齐火山三版本差异）：增强策略仅 pro/max 可用，色彩校正仅 max 可用。
 *  input 六键恒冻结全量值；本矩阵约束前端置灰逻辑、后端复核口径与 worker 出站裁剪。 */
export const IMAGE_ENHANCE_TIER_CAPABILITY: Record<
  ImageEnhanceVersionTier,
  { enhanceMode: boolean; correctColor: boolean }
> = {
  lite: { enhanceMode: false, correctColor: false },
  pro: { enhanceMode: true, correctColor: false },
  max: { enhanceMode: true, correctColor: true },
};

/** 面板默认值（与火山官方默认一致；前端初始态、后端复核缺省同源）：
 *  默认档 pro、倍数 2、策略生成度优先、色彩校正开。 */
export const IMAGE_ENHANCE_DEFAULTS = {
  versionTier: "pro",
  multiple: 2,
  generativeEnhanceMode: "generative_first",
  enableCorrectColor: true,
} as const;

/** input 冻结结构（IKGM99 创建入口复核与重试沿用都用本 schema；strict 防多余键）。 */
export const imageEnhanceInputSchema = z
  .object({
    [IMAGE_ENHANCE_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [IMAGE_ENHANCE_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [IMAGE_ENHANCE_INPUT_KEYS.versionTier]: z.enum(IMAGE_ENHANCE_VERSION_TIERS),
    [IMAGE_ENHANCE_INPUT_KEYS.multiple]: z.union([
      z.literal(2),
      z.literal(4),
      z.literal(6),
    ]),
    [IMAGE_ENHANCE_INPUT_KEYS.generativeEnhanceMode]: z.enum(IMAGE_ENHANCE_MODES),
    [IMAGE_ENHANCE_INPUT_KEYS.enableCorrectColor]: z.boolean(),
  })
  .strict();
export type ImageEnhanceInput = z.infer<typeof imageEnhanceInputSchema>;
