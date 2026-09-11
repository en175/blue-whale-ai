import { extractTextNodeText } from "@blue-whale/core";
import { BadRequestException } from "@nestjs/common";
import { CANVAS_EDGE_LIMITS, promptBindingList, promptBindingsSchema, promptMentionSchema, previewSourceSchema, validPromptMentions, type CanvasEdge, type PromptBinding } from "@blue-whale/contracts";
import type { ModelCapabilityView } from "@lib/shared/persistence/model-capability-repo.js";

export interface PromptTargetNode { id: string; type: string; data?: Record<string, unknown> }

export function nodeAssetId(node: PromptTargetNode | undefined): string {
  return String(node?.data?.assetId ?? node?.data?.asset_id ?? node?.data?.assetID ?? "");
}

export function planError(nodeId: string, bindings: PromptBinding[], reason: string): never {
  throw new BadRequestException(`方案 ${nodeId} 索引 ${bindings.map(b => `#${b.index}`).join("、") || "（正文）"}：${reason}`);
}

export function readPromptPlan(node: PromptTargetNode) {
  const text = node.data?.promptMentions === undefined ? extractTextNodeText(node.data) : node.data.text;
  const mentions = promptMentionSchema.array().safeParse(node.data?.promptMentions ?? []);
  if (node.type !== "textNode" || !previewSourceSchema.safeParse(node.data?.promptSource).success
    || typeof text !== "string" || !mentions.success || !validPromptMentions(text, mentions.data)) {
    planError(node.id, [], "正文素材索引无效");
  }
  const bindings = promptBindingList(mentions.data);
  const materials = Array.isArray(node.data?.promptMaterials) ? node.data.promptMaterials as Array<{ assetId: string; mediaType: string }> : [];
  for (const binding of bindings) {
    if (!materials.some(m => m.assetId === binding.assetId && m.mediaType === "image")) {
      planError(node.id, [binding], "图片目标仅支持图片素材，不能漏传正文引用");
    }
  }
  return { nodeId: node.id, text, mentions: mentions.data, bindings };
}

export function validatePlanModel(nodeId: string, bindings: PromptBinding[], count: number, model: ModelCapabilityView | undefined) {
  if (!model) planError(nodeId, bindings, "请选择可用图片模型");
  if (count > 0 && !model.features.reference_image) planError(nodeId, bindings, "当前模型不支持图片参考");
  if (count > model.features.max_reference_images) planError(nodeId, bindings, `参考图最多 ${model.features.max_reference_images} 张，请调整引用或模型`);
}

export function confirmPlanEdges(nodes: PromptTargetNode[], edges: CanvasEdge[], planNodeId: string, targetNodeId: string) {
  const node = nodes.find(n => n.id === planNodeId);
  const target = nodes.find(n => n.id === targetNodeId);
  if (!node || !target || target.type !== "mediaNode" || target.data?.mediaType !== "image") {
    throw new BadRequestException("方案或图片目标不存在");
  }
  if (target.data?.genStatus === "generating") throw new BadRequestException("生成中，输入连线只读");
  const plan = readPromptPlan(node);
  const next = edges.map(e => ({ ...e, ...(e.data ? { data: { ...e.data } } : {}) }));
  const oldPlanEdge = next.find(e => e.source === planNodeId && e.target === targetNodeId);
  if (oldPlanEdge?.data?.promptReference !== undefined) {
    const confirmed = promptBindingsSchema.safeParse((oldPlanEdge.data.promptReference as { bindings?: unknown }).bindings);
    if (!confirmed.success || JSON.stringify(confirmed.data) !== JSON.stringify(plan.bindings)) planError(node.id, confirmed.success ? confirmed.data : plan.bindings, "素材待同步，请先同步素材到目标");
  }
  for (const assetId of new Set(plan.bindings.map(b => b.assetId))) {
    let edge = next.find(e => e.target === targetNodeId && nodes.some(n => n.type === "mediaNode" && n.id === e.source && nodeAssetId(n) === assetId));
    const source = edge ? nodes.find(n => n.id === edge!.source) : nodes.find(n => n.type === "mediaNode" && nodeAssetId(n) === assetId);
    if (!source || source.data?.assetMissing || source.data?.mediaType !== "image" || source.data?.genStatus === "generating") planError(node.id, plan.bindings.filter(b => b.assetId === assetId), "素材缺失，请补充素材或移除对应引用后再生成");
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
