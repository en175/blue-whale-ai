import { NewApiError, extractTextNodeText } from "@lib/core";
import { BadRequestException } from "@nestjs/common";
import { CANVAS_EDGE_LIMITS, promptBindingList, promptBindingsSchema, promptMentionSchema, previewSourceSchema, validPromptMentions, type CanvasEdge, type PromptBinding } from "@lib/contracts";
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

export function confirmPlanEdges(nodes: PromptTargetNode[], edges: CanvasEdge[], planNodeId: string, targetNodeId: string, syncBindings?: PromptBinding[]) {
  const node = nodes.find(n => n.id === planNodeId);
  const target = nodes.find(n => n.id === targetNodeId);
  if (!node || !target || target.type !== "mediaNode" || !["image", "video"].includes(String(target.data?.mediaType))) {
    throw new BadRequestException("方案或生成目标不存在");
  }
  if (target.data?.genStatus === "generating") throw new BadRequestException("生成中，输入连线只读");
  const plan = readPromptPlan(node, target.data?.mediaType as "image" | "video");
  let next = edges.map(e => ({ ...e, ...(e.data ? { data: { ...e.data } } : {}) }));
  const oldPlanEdge = next.find(e => e.source === planNodeId && e.target === targetNodeId);
  if (syncBindings !== undefined) {
    if (!oldPlanEdge) throw new BadRequestException("方案尚未引用到该目标");
    if (JSON.stringify(syncBindings) !== JSON.stringify(plan.bindings)) throw new NewApiError("方案素材已变化，请重新确认同步", 412);
    const requiredIds = new Set(plan.bindings.map(b => b.assetId));
    next = next.filter(edge => {
      if (edge.target !== targetNodeId || edge === oldPlanEdge) return true;
      const sources = edge.data?.inputSources as { manual: boolean; planNodeIds: string[] } | undefined;
      if (!sources?.planNodeIds.includes(planNodeId) || requiredIds.has(nodeAssetId(nodes.find(n => n.id === edge.source)))) return true;
      const remaining = sources.planNodeIds.filter(id => id !== planNodeId);
      edge.data = { ...edge.data, inputSources: { manual: sources.manual, planNodeIds: remaining } };
      return sources.manual || remaining.length > 0;
    });
  } else if (oldPlanEdge?.data?.promptReference !== undefined) {
    const confirmed = promptBindingsSchema.safeParse((oldPlanEdge.data.promptReference as { bindings?: unknown }).bindings);
    if (!confirmed.success || JSON.stringify(confirmed.data) !== JSON.stringify(plan.bindings)) planError(node.id, confirmed.success ? confirmed.data : plan.bindings, "素材待同步，请先同步素材到目标");
  }
  for (const assetId of new Set(plan.bindings.map(b => b.assetId))) {
    let edge = next.find(e => e.target === targetNodeId && nodes.some(n => n.type === "mediaNode" && n.id === e.source && nodeAssetId(n) === assetId));
    const source = edge ? nodes.find(n => n.id === edge!.source) : nodes.find(n => n.type === "mediaNode" && nodeAssetId(n) === assetId);
    if (!source || source.data?.assetMissing || !["image", "video", "audio"].includes(String(source.data?.mediaType)) || source.data?.genStatus === "generating") planError(node.id, plan.bindings.filter(b => b.assetId === assetId), "素材缺失，请补充素材或移除对应引用后再生成");
    if (!edge) {
      edge = { id: `e-${source.id}-${targetNodeId}`, source: source.id, target: targetNodeId, data: { inputSources: { manual: false, planNodeIds: [] } } };
      next.push(edge);
    }
    const sources = edge.data?.inputSources as { manual: boolean; planNodeIds: string[] } | undefined;
    edge.data = { ...edge.data, inputSources: { manual: sources?.manual ?? true, planNodeIds: [...new Set([...(sources?.planNodeIds ?? []), planNodeId])] } };
  }
  const reference = { bindings: plan.bindings };
  if (oldPlanEdge) oldPlanEdge.data = { ...oldPlanEdge.data, promptReference: reference };
  else next.push({ id: `e-${planNodeId}-${targetNodeId}`, source: planNodeId, target: targetNodeId, data: { promptReference: reference } });
  if (next.length > CANVAS_EDGE_LIMITS.maxEdges || Buffer.byteLength(JSON.stringify(next)) > CANVAS_EDGE_LIMITS.edgesBytes) throw new BadRequestException("连线数量或内容超限");
  const ids = [...new Set(next.filter(e => e.target === targetNodeId).flatMap(e => {
    const source = nodes.find(n => n.id === e.source && n.type === "mediaNode");
    return source ? [nodeAssetId(source)] : [];
  }))];
  return { plan, edges: next, assetIds: ids };
}

/** IKFC26：方案绑定把媒体实际引入目标后同步视频草稿模式——目标为文生视频（draftMode=prompt）
 *  且方案素材索引含媒体时切为全能参考（all），与前端门控自动切换同向（IKFC1T 契约 §2 服务端对等）；
 *  仅 prompt → all 单向，不切回；文本附件不属媒体引用（bindings 为空不触发）；其他模式与
 *  无 draftMode 旧草稿原样保留（后者由前端门控在面板打开时纠正）。无需切换时原样返回同一引用。 */
export function syncDraftModeOnPlanMedia(nodes: PromptTargetNode[], targetNodeId: string, bindings: PromptBinding[]): PromptTargetNode[] {
  if (bindings.length === 0) return nodes;
  const target = nodes.find(n => n.id === targetNodeId);
  if (target?.data?.draftMode !== "prompt") return nodes;
  return nodes.map(n => n.id === targetNodeId ? { ...n, data: { ...n.data, draftMode: "all" } } : n);
}

/** Video reference validation uses the existing execution constraints before accepting any edges/job. */
export function validateVideoPlan(nodeId: string, bindings: PromptBinding[], refs: Array<{ type: string; role: string }>, model: ModelCapabilityView | undefined, mode?: unknown) {
  if (!model) planError(nodeId, bindings, "请选择可用视频模型");
  const frames = refs.filter(r => r.role !== "reference");
  const ordinary = refs.filter(r => r.role === "reference");
  if (frames.some(r => r.type !== "image")) planError(nodeId, bindings, "首尾帧仅支持图片");
  if (frames.length && ordinary.length) planError(nodeId, bindings, "首尾帧与普通参考不能混用");
  if (mode === "keyframe" && ordinary.length) planError(nodeId, bindings, "首尾帧模式不支持普通参考，请调整模式或引用");
  if ((mode === "all" || mode === "text2video") && frames.length) planError(nodeId, bindings, "当前模式不支持首尾帧，请调整模式或引用");
  if (mode === "text2video" && ordinary.some(r => r.type !== "image")) planError(nodeId, bindings, "图生视频模式不支持视频或音频参考");
  if (frames.some(r => r.role === "first_frame") && !(model.features.first_frame || model.features.first_last_frame)) planError(nodeId, bindings, "当前模型不支持首帧");
  if (frames.some(r => r.role === "last_frame") && !(model.features.last_frame || model.features.first_last_frame)) planError(nodeId, bindings, "当前模型不支持尾帧");
  validatePlanModel(nodeId, bindings, ordinary.filter(r => r.type === "image").length, model);
}
