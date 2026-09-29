import { z } from "zod";

/* 智能扩图（image_outpaint）跨进程任务契约（IKGOQR，契约先行红线）：
   权威规格 = docs/specs/2026-09-18-image-outpaint-mediakit.md（Implementation Decisions）；
   关键取舍见 docs/adr/0093-image-outpaint-mediakit-expand-canvas.md；术语见根 GLOSSARY.md「画布图片扩图」。
   跨进程字段在本文件定死后双端实现：worker-java 侧同名常量类
   ImageOutpaintContract（domain/entity），防漂移断言见 image-outpaint.test.ts。
   后续票（创建入口 / worker 执行 / 前端）一律引用本文件，不得发明字段名。
   结果回填约定（同高清放大 §14.5）：成功时 worker 下载结果图（火山 URL 仅 24h 有效）
   → 落对象存储公开读 → 建 Asset（type=image / source='generated' / generation_job_id）
   → 终态 succeeded，前端按 target_node_id 回填扩图结果卡（源卡不动）；
   失败时落 failed 与既有错误码投影（兜底 image_outpaint_failed），无自动重试，用户在结果卡手动重试
   并沿用冻结 input。 */

/** 任务类型值：generation_jobs.type 与 RocketMQ tag 同值（沿用既有 tag=type 口径）；
 *  backend 入队用 queue.constants.ts 的 IMAGE_OUTPAINT_TAG（与本常量恒等）。 */
export const IMAGE_OUTPAINT_JOB_TYPE = "image_outpaint";

/** 任务来源值：扩图只有画布图片卡工具条「高清 ▾」菜单一个创建入口，claim SQL 的 source 白名单
 *  仅含本值（media_extract 的 source="dock" 同款「专属来源值」模式）；连线为纯视觉来源线，
 *  不参与参考推导与 @ 编号。 */
export const IMAGE_OUTPAINT_SOURCE = "image_outpaint";

/** input 冻结键名（六键恒在、创建时定死，重试原样沿用）。 */
export const IMAGE_OUTPAINT_INPUT_KEYS = {
  /** 源素材身份（被扩图的图片 Asset id；命名沿用 media_extract 的 source_asset_id）。 */
  sourceAssetId: "source_asset_id",
  /** 目标节点身份（画布扩图结果卡 node id，前端回填结果时定位用；worker 不消费画布拓扑）。 */
  targetNodeId: "target_node_id",
  /** 上方扩展比例（与火山 API 参数 expand_top 同名同值，相对原图短边）。 */
  expandTop: "expand_top",
  /** 下方扩展比例（与火山 API 参数 expand_bottom 同名同值，相对原图短边）。 */
  expandBottom: "expand_bottom",
  /** 左侧扩展比例（与火山 API 参数 expand_left 同名同值，相对原图短边）。 */
  expandLeft: "expand_left",
  /** 右侧扩展比例（与火山 API 参数 expand_right 同名同值，相对原图短边）。 */
  expandRight: "expand_right",
} as const;

/** 基础设施键（六键之上、非客户端 payload）：用户 sk- 凭证由创建侧 controller 从
 *  authorization 头取出注入冻结（IKGLZV 审查 P0 口径，与图片生成/高清放大同构），
 *  不进 imageOutpaintInputSchema（strict 六键校验的是客户端提交参数）；
 *  worker 处理时取本键出站鉴权。单处定义防字面量漂移。 */
export const IMAGE_OUTPAINT_PROVIDER_CREDENTIAL_KEY = "provider_credential";

/** 单方向扩展比例值域（相对原图短边）：[0, 0.4]，0 表示该方向不扩；
 *  四键中至少一项 > 0（零扩展无任务意义，schema refine 拦截）。
 *  火山官方接口四参数默认各 0.1，但产品总是显式传值（初始框零扩展即传 0），不依赖官方默认。 */
export const IMAGE_OUTPAINT_EXPAND_RATIO_LIMITS = {
  min: 0,
  max: 0.4,
} as const;

/** 源图门槛（单处定义，规格内联口径，火山官方 PDF 溯源）：
 *  长边 = max(width, height) ≤ 4160px、文件 ≤ 10MB、真实宽高必须已知（与高清放大
 *  「缺尺寸放行」相反——扩展比例换算依赖短边，无尺寸无法预检 40% 上限）。
 *  缺尺寸处置（IKGOQ0 验收修订）：资产宽高为 NULL 时服务端先从对象存储 Range 读头
 *  探测真实宽高并回填资产行（画布/资产库上传路径历史上不上报尺寸，库存约四成图片
 *  如此），探测不到才按 missingDimensionsText 拒绝——彼时文件本身有问题，
 *  「请重新上传」名副其实。
 *  消费方 = backend image-outpaints 服务端复核 + web 菜单项预检（两端判定与数值只此一份）；
 *  worker-java 不消费，出站前任务输入已过复核。 */
export const IMAGE_OUTPAINT_SOURCE_LIMITS = {
  /** 源图长边上限（px）。 */
  maxLongSide: 4160,
  /** 源文件大小上限（字节，10MB = 10 * 1024 * 1024）。 */
  maxFileSizeBytes: 10 * 1024 * 1024,
  /** 真实宽高缺失的拒绝文案（服务端 fail msg 与前端置灰提示同源）。 */
  missingDimensionsText: "图片缺少真实尺寸信息，无法发起扩图，请重新上传该图片后再试",
  /** 长边超限的拒绝文案。 */
  longSideRejectionText: "源图长边超过 4160px，无法发起扩图，请先压缩图片",
  /** 文件大小超限的拒绝文案。 */
  fileSizeRejectionText: "源图文件超过 10MB，无法发起扩图，请先压缩图片",
} as const;

/** 源图门槛判定（单处）：不满足返回拒绝文案，满足返回 null。
 *  宽高缺失/非正数 → missingDimensionsText（调用方传 null | undefined 即可，无须预判）；
 *  文件大小缺失（fileSizeBytes 为 null/undefined）时不臆造、跳过大小判定
 *  （源 Asset 的 size 恒在，此分支仅防御调用方缺参）。 */
export function imageOutpaintSourceGate(
  width: number | null | undefined,
  height: number | null | undefined,
  fileSizeBytes: number | null | undefined,
): string | null {
  if (width == null || height == null || width <= 0 || height <= 0) {
    return IMAGE_OUTPAINT_SOURCE_LIMITS.missingDimensionsText;
  }
  const longSide = Math.max(width, height);
  if (longSide > IMAGE_OUTPAINT_SOURCE_LIMITS.maxLongSide) {
    return IMAGE_OUTPAINT_SOURCE_LIMITS.longSideRejectionText;
  }
  if (
    fileSizeBytes != null &&
    fileSizeBytes > IMAGE_OUTPAINT_SOURCE_LIMITS.maxFileSizeBytes
  ) {
    return IMAGE_OUTPAINT_SOURCE_LIMITS.fileSizeRejectionText;
  }
  return null;
}

const expandRatioSchema = z
  .number()
  .min(IMAGE_OUTPAINT_EXPAND_RATIO_LIMITS.min)
  .max(IMAGE_OUTPAINT_EXPAND_RATIO_LIMITS.max);

/** input 冻结结构（创建入口复核与重试沿用都用本 schema；strict 防多余键）。
 *  四键全 0（零扩展）由 refine 拒绝——前端发送钮同口径置灰，服务端兜底。 */
export const imageOutpaintInputSchema = z
  .object({
    [IMAGE_OUTPAINT_INPUT_KEYS.sourceAssetId]: z.string().regex(/^[1-9][0-9]*$/),
    [IMAGE_OUTPAINT_INPUT_KEYS.targetNodeId]: z.string().min(1),
    [IMAGE_OUTPAINT_INPUT_KEYS.expandTop]: expandRatioSchema,
    [IMAGE_OUTPAINT_INPUT_KEYS.expandBottom]: expandRatioSchema,
    [IMAGE_OUTPAINT_INPUT_KEYS.expandLeft]: expandRatioSchema,
    [IMAGE_OUTPAINT_INPUT_KEYS.expandRight]: expandRatioSchema,
  })
  .strict()
  .refine(
    (input) =>
      input[IMAGE_OUTPAINT_INPUT_KEYS.expandTop] > 0 ||
      input[IMAGE_OUTPAINT_INPUT_KEYS.expandBottom] > 0 ||
      input[IMAGE_OUTPAINT_INPUT_KEYS.expandLeft] > 0 ||
      input[IMAGE_OUTPAINT_INPUT_KEYS.expandRight] > 0,
    { message: "至少一个方向的扩展比例需大于 0" },
  );
export type ImageOutpaintInput = z.infer<typeof imageOutpaintInputSchema>;
