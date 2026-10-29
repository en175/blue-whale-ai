import { BadRequestException } from "@nestjs/common";

import {
  mediaAndPromptMentionsDisjoint,
  mediaMentionSchema,
  mediaRefSchema,
  mediaRefsCoverMentions,
  promptMentionSchema,
  validMediaMentions,
} from "@lib/contracts";

export interface CanvasNodeValidationLimits {
  text: number;
  title: number;
}

export interface CanvasNodeLike {
  id: string;
  type: string;
  data?: Record<string, unknown>;
}

export function validateNodePayload(node: CanvasNodeLike, limits: CanvasNodeValidationLimits): void {
  if (
    (node.data?.promptMaterials !== undefined ||
      node.data?.promptMentions !== undefined ||
      node.data?.promptOriginalTitle !== undefined) &&
    node.data?.promptSource === undefined
  ) {
    throw new BadRequestException("方案素材身份不可伪造，请使用应用入口");
  }
  if (node.type === "mediaNode") {
    const signature = node.data?.usedInputSignature;
    const jobId = node.data?.usedInputJobId;
    if (
      (signature !== undefined &&
        (typeof signature !== "string" || signature.length === 0 || signature.length > 128)) ||
      (jobId !== undefined && (typeof jobId !== "number" || !Number.isInteger(jobId) || jobId <= 0))
    ) {
      throw new BadRequestException("输入更新状态字段无效，原内容未改动");
    }
  }
  if (node.type !== "textNode") return;
  if (
    (typeof node.data?.text === "string" && node.data.text.length > limits.text) ||
    (typeof node.data?.html === "string" && node.data.html.length > limits.text) ||
    (typeof node.data?.title === "string" && node.data.title.length > limits.title)
  ) {
    throw new BadRequestException(
      `文本超限（标题 ${limits.title}，正文 ${limits.text} 字），原内容未改动`,
    );
  }
}

export function validateMediaIndexShape(node: CanvasNodeLike): void {
  const hasMentions = node.data?.mediaMentions !== undefined;
  const hasRefs = node.data?.mediaRefs !== undefined;
  if (!hasMentions && !hasRefs) return;
  if (node.type !== "textNode" || hasMentions !== hasRefs) {
    throw new BadRequestException("正文媒体索引字段无效，原内容未改动");
  }
  const mentions = mediaMentionSchema.array().safeParse(node.data?.mediaMentions);
  const refs = mediaRefSchema.array().safeParse(node.data?.mediaRefs);
  const text = typeof node.data?.text === "string" ? node.data.text : "";
  if (
    !mentions.success ||
    !refs.success ||
    !validMediaMentions(text, mentions.data) ||
    !mediaRefsCoverMentions(mentions.data, refs.data)
  ) {
    throw new BadRequestException("正文媒体索引无效，原内容未改动");
  }
  const promptMentions = promptMentionSchema.array().safeParse(node.data?.promptMentions ?? []);
  if (
    !mediaAndPromptMentionsDisjoint(
      mentions.data,
      promptMentions.success ? promptMentions.data : [],
    )
  ) {
    throw new BadRequestException("正文媒体索引与方案绑定区间重叠，原内容未改动");
  }
}

export function validatePromptSourcePayload(node: CanvasNodeLike): string[] {
  if (node.data?.promptSource === undefined) return [];
  if (
    node.type !== "textNode" ||
    typeof node.data?.text !== "string" ||
    typeof node.data?.title !== "string"
  ) {
    throw new BadRequestException("预览来源不可修改或重复，请使用应用入口");
  }
  const materials = Array.isArray(node.data?.promptMaterials)
    ? (node.data.promptMaterials as Array<{ assetId?: unknown; mediaType?: unknown; url?: unknown }>)
    : [];
  if (
    materials.some(
      (item) => !item || typeof item.assetId !== "string" || typeof item.mediaType !== "string" || typeof item.url !== "string",
    ) ||
    new Set(materials.map((item) => item.assetId)).size !== materials.length
  ) {
    throw new BadRequestException("方案素材身份无效或重复");
  }
  return materials.map((item) => item.assetId as string);
}
