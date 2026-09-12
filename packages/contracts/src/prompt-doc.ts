import { z } from "zod";

/* ============================================
 * IKFA1M：正文素材标签（prompt_doc）契约
 *
 * 生图面板主提示词的结构化表示：文字与「素材标签」交替的片段序列。
 * 标签绑定稳定身份（本地 Asset id），展示编号（图片N）由身份在
 * 最终有效输入顺序中的位置派生——编号不是身份，不能当主键。
 * 语义权威文档：docs/specs/2026-09-12-ikfa1m-image-prompt-ref-contract.md
 * ============================================ */

/** 结构版本：只有 1。旧/新版本不猜造、不迁移（旧纯文本草稿沿原有语义）。 */
export const PROMPT_DOC_VERSION = 1;

/** 稳定身份：本地 Asset 纯数字 id（与生成接纳 assetId() 同口径），
 *  或素材库 asset- 前缀 id（IKFA1O 视频多媒体标签；与 materialId() 同口径，大小写不敏感）。 */
const assetIdSchema = z.string().regex(/^([1-9][0-9]*|asset-.{1,128})$/i);

/** 正文片段：文字 | 素材标签。标签位置由片段顺序隐式表达，不使用字符区间。 */
export const promptDocSegmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }).strict(),
  z
    .object({
      kind: z.literal("asset_ref"),
      asset_id: assetIdSchema,
      /**
       * 展示编号缓存（图片N）：客户端编辑期维护，失效时作为「原编号」引用。
       * 服务端编译一律按最终输入顺序派生编号，从不消费该字段——编号不是身份。
       */
      label: z.string().min(1).optional(),
      /**
       * 失效恢复信息：标签失效时保留的原展示编号（如 "图片2"）。
       * 存在即表示该提及已失效——失效标签不允许提交生成（阻止生成由服务端复核），
       * 也不因编号被复用而转向其他素材。
       */
      invalid_label: z.string().min(1).optional(),
    })
    .strict(),
]);
export type PromptDocSegment = z.infer<typeof promptDocSegmentSchema>;

export const promptDocSchema = z
  .object({
    version: z.literal(PROMPT_DOC_VERSION),
    segments: z.array(promptDocSegmentSchema).max(500),
  })
  .strict();
export type PromptDoc = z.infer<typeof promptDocSchema>;

/**
 * 展示编号派生：图片N = asset_id 在最终有效输入顺序（保序）中的下标 + 1。
 * 编号跟真实媒体输入顺序，不跟正文出现顺序；身份不在集合中返回 null（失效）。
 */
export function imageRefLabel(
  assetId: string,
  orderedAssetIds: readonly string[],
): string | null {
  const index = orderedAssetIds.indexOf(assetId);
  return index < 0 ? null : `图片${index + 1}`;
}

export type PromptDocRefFailure =
  | { kind: "invalid_tag"; assetId: string }
  | { kind: "unknown_asset"; assetId: string };

/**
 * 接纳前校验（服务端复核）：存在失效标签或标签指向不在最终输入集合的身份时返回首个问题。
 * orderedAssetIds 必须已通过存在性/归属/类型校验（与参考图同一复核链路）。
 */
export function validatePromptDocRefs(
  doc: PromptDoc,
  orderedAssetIds: readonly string[],
): PromptDocRefFailure | null {
  for (const segment of doc.segments) {
    if (segment.kind !== "asset_ref") continue;
    if (segment.invalid_label !== undefined) {
      return { kind: "invalid_tag", assetId: segment.asset_id };
    }
    if (!orderedAssetIds.includes(segment.asset_id)) {
      return { kind: "unknown_asset", assetId: segment.asset_id };
    }
  }
  return null;
}

/**
 * 编译：把每个标签替换为其展示编号（图片N），文字原样拼接，得到发送给模型的正文。
 * 同一素材多次提及编译为同一编号；未提及的参考不参与正文（保持既有输入语义）。
 * 调用方必须先过 validatePromptDocRefs——失效或未知身份不可编译。
 */
export function compilePromptDoc(
  doc: PromptDoc,
  orderedAssetIds: readonly string[],
): string {
  return doc.segments
    .map((segment) => {
      if (segment.kind === "text") return segment.text;
      const label = imageRefLabel(segment.asset_id, orderedAssetIds);
      if (segment.invalid_label !== undefined || label === null) {
        throw new Error(
          "compilePromptDoc 要求先通过 validatePromptDocRefs：失效或未知身份的标签不可编译",
        );
      }
      return label;
    })
    .join("");
}

/* ============================================
 * IKFA1O：视频多媒体标签与首尾帧角色
 *
 * 视频参考集合即生成接纳的单数组 references（保序，帧在前）；
 * 标签文案按身份的实际角色/类型派生——首尾帧按角色显示，普通参考按
 * 同类型在 reference 序中的顺序连续编号（图片N/视频N/音频N）。
 * ============================================ */

/** 视频参考输入：references 单数组元素的编译投影（asset_id/material_id 统一为 id） */
export interface VideoRefItem {
  id: string;
  role: "first_frame" | "last_frame" | "reference";
  type: "image" | "video" | "audio";
}

const VIDEO_TYPE_LABELS: Record<VideoRefItem["type"], string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

/**
 * 视频标签文案派生：首帧/尾帧按角色；普通参考按同类型顺序编号；身份不在集合返回 null（失效）。
 * 文案跟提交的 references 实际结构，不信任客户端 label 缓存（C1：角色变化同步标签）。
 */
export function videoRefLabel(
  refId: string,
  refs: readonly VideoRefItem[],
): string | null {
  const typeCounters = new Map<VideoRefItem["type"], number>();
  for (const ref of refs) {
    if (ref.role === "first_frame") {
      if (ref.id === refId) return "首帧";
      continue;
    }
    if (ref.role === "last_frame") {
      if (ref.id === refId) return "尾帧";
      continue;
    }
    const next = (typeCounters.get(ref.type) ?? 0) + 1;
    typeCounters.set(ref.type, next);
    if (ref.id === refId) return `${VIDEO_TYPE_LABELS[ref.type]}${next}`;
  }
  return null;
}

/**
 * 视频接纳前校验：存在失效标签或标签身份不在 references（asset_id ∪ material_id）时返回首个问题。
 * refs 必须已通过既有 references 结构与存在性/归属校验（与参考素材同一复核链路）。
 */
export function validateVideoPromptDocRefs(
  doc: PromptDoc,
  refs: readonly VideoRefItem[],
): PromptDocRefFailure | null {
  for (const segment of doc.segments) {
    if (segment.kind !== "asset_ref") continue;
    if (segment.invalid_label !== undefined) {
      return { kind: "invalid_tag", assetId: segment.asset_id };
    }
    if (!refs.some((ref) => ref.id === segment.asset_id)) {
      return { kind: "unknown_asset", assetId: segment.asset_id };
    }
  }
  return null;
}

/**
 * 视频正文编译：帧标签 → 首帧/尾帧；普通参考标签 → 同类型编号（图片N/视频N/音频N）；
 * 文字原样拼接。调用方必须先过 validateVideoPromptDocRefs。
 */
export function compileVideoPromptDoc(
  doc: PromptDoc,
  refs: readonly VideoRefItem[],
): string {
  return doc.segments
    .map((segment) => {
      if (segment.kind === "text") return segment.text;
      const label = videoRefLabel(segment.asset_id, refs);
      if (segment.invalid_label !== undefined || label === null) {
        throw new Error(
          "compileVideoPromptDoc 要求先通过 validateVideoPromptDocRefs：失效或未知身份的标签不可编译",
        );
      }
      return label;
    })
    .join("");
}
