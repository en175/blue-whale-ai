import { extractTextNodeText } from "@lib/core";
import { BadRequestException } from "@nestjs/common";
import { normalizeVideoMode, promptBindingList, promptMentionSchema, previewSourceSchema, validPromptMentions, type PromptBinding } from "@lib/contracts";
import type { ModelCapabilityView } from "@lib/shared/persistence/model-capability-repo.js";

export interface PromptTargetNode { id: string; type: string; data?: Record<string, unknown> }

export function nodeAssetId(node: PromptTargetNode | undefined): string {
  return String(node?.data?.assetId ?? node?.data?.asset_id ?? node?.data?.assetID ?? "");
}

/** IKE5G8 实现决定 7.2 的素材缺失文案（规格权威源；勿在调用点另写一份）。 */
export const MISSING_PROMPT_REF_REASON = "提示词引用的素材缺失或不完整，请补充素材或移除对应引用后再生成";

/** 方案索引消息拼接（「索引 #N、#M：reason」）——只服务方案冻结（planError）的缺失项文案；
 *  通用存在性检查自 IKG6EK / ADR-0088 起走通用信封，不再复用本格式。 */
export function planIndicesMessage(indices: readonly string[], reason: string): string {
  return `索引 ${indices.join("、") || "（正文）"}：${reason}`;
}

export function planError(nodeId: string, bindings: PromptBinding[], reason: string): never {
  throw new BadRequestException(`方案 ${nodeId} ${planIndicesMessage(bindings.map(b => `#${b.index}`), reason)}`);
}

export function readPromptPlan(node: PromptTargetNode, targetType: "image" | "video" = "image") {
  const text = node.data?.promptMentions === undefined ? extractTextNodeText(node.data) : node.data.text;
  const mentions = promptMentionSchema.array().safeParse(node.data?.promptMentions ?? []);
  if (node.type !== "textNode" || !previewSourceSchema.safeParse(node.data?.promptSource).success
    || typeof text !== "string" || !mentions.success || !validPromptMentions(text, mentions.data)) {
    planError(node.id, [], "正文素材索引无效");
  }
  const bindings = promptBindingList(mentions.data);
  const materials = Array.isArray(node.data?.promptMaterials) ? node.data.promptMaterials as Array<{ assetId: string; mediaType: string }> : [];
  for (const binding of bindings) {
    if (!materials.some(m => m.assetId === binding.assetId && (targetType === "video" ? ["image", "video", "audio"].includes(m.mediaType) : m.mediaType === "image"))) {
      planError(node.id, [binding], "图片目标仅支持图片素材，不能漏传正文引用");
    }
  }
  return { nodeId: node.id, text, mentions: mentions.data, bindings };
}

export function validatePlanModel(nodeId: string, bindings: PromptBinding[], count: number, model: ModelCapabilityView | undefined) {
  if (!model) planError(nodeId, bindings, "请选择可用图片模型");
  if (count > 0 && !model.features.reference_image) planError(nodeId, bindings, "当前模型不支持图片参考");
  if (count > model.features.image_reference_max) planError(nodeId, bindings, `参考图最多 ${model.features.image_reference_max} 张，请调整引用或模型`);
}

/** Video reference validation uses the existing execution constraints before accepting any edges/job. */
export function validateVideoPlan(nodeId: string, bindings: PromptBinding[], refs: Array<{ type: string; role: string }>, model: ModelCapabilityView | undefined, mode?: unknown) {
  if (!model) planError(nodeId, bindings, "请选择可用视频模型");
  const videoMode = normalizeVideoMode(mode);
  const frameMode = videoMode === "first_frame" || videoMode === "first_last_frame";
  const frames = refs.filter(r => r.role !== "reference");
  const ordinary = refs.filter(r => r.role === "reference");
  if (frames.some(r => r.type !== "image")) planError(nodeId, bindings, "首尾帧仅支持图片");
  if (frames.length && ordinary.length) planError(nodeId, bindings, "首尾帧与普通参考不能混用");
  if (frameMode && ordinary.length) planError(nodeId, bindings, "首尾帧模式不支持普通参考，请调整模式或引用");
  if (videoMode && !frameMode && frames.length) planError(nodeId, bindings, "当前模式不支持首尾帧，请调整模式或引用");
  if (videoMode === "image_reference" && ordinary.some(r => r.type !== "image")) planError(nodeId, bindings, "图片参考模式不支持视频或音频参考");
  if ((videoMode === "edit" || videoMode === "extend") && !ordinary.some(r => r.type === "video")) planError(nodeId, bindings, "视频编辑模式至少需要 1 段参考视频");
  if (frames.some(r => r.role === "first_frame") && !(model.features.first_frame || model.features.first_last_frame)) planError(nodeId, bindings, "当前模型不支持首帧");
  if (frames.some(r => r.role === "last_frame") && !(model.features.last_frame || model.features.first_last_frame)) planError(nodeId, bindings, "当前模型不支持尾帧");
  validatePlanModel(nodeId, bindings, ordinary.filter(r => r.type === "image").length, model);
}
