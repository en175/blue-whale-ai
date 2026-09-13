import { validateReferences } from "../generation-runtime/video-reference-validation.js";
import { composeTextAttachmentPrompt } from "@lib/core";
import { COMPOSED_IMAGE_PROMPT_MAX_LENGTH, COMPOSED_VIDEO_PROMPT_MAX_LENGTH, promptBindingsSchema, type CanvasEdge, type PromptPlanSnapshot, type TextAttachmentSnapshot } from "@lib/contracts";
import { nodeAssetId, planError, readPromptPlan, validatePlanModel, validateVideoPlan, type PromptTargetNode } from "../canvas/prompt-target.js";
import type { ModelCapabilityView } from "../persistence/model-capability-repo.js";
import type { AssetOwnershipOps } from "../persistence/asset-ownership-types.js";

export async function freezePromptPlans(args: {
  nodes: PromptTargetNode[]; edges: CanvasEdge[]; version: number; targetId: string;
  type?: "image" | "video";
  references?: Array<{ asset_id?: string; material_id?: string; type: "image" | "video" | "audio"; role: "reference" | "first_frame" | "last_frame" }>;
  inputIds: string[]; prompt: string; attachments: TextAttachmentSnapshot[];
  model: ModelCapabilityView | undefined; userId: string; projectId: string;
  assets: Pick<AssetOwnershipOps, "resolveInputAssets">;
}): Promise<PromptPlanSnapshot | undefined> {
  const { nodes, edges, targetId, inputIds, attachments } = args;
  const planNodes = attachments.flatMap(a => {
    const n = nodes.find(n => n.id === a.node_id);
    const edge = edges.find(e => e.source === a.node_id && e.target === targetId);
    return n?.data?.promptSource && (n.data.promptMentions !== undefined || edge?.data?.promptReference !== undefined) ? [n] : [];
  });
  if (!planNodes.length) return undefined;
  const plans = planNodes.map(n => readPromptPlan(n, args.type));
  const directIds = [...new Set(edges.filter(e => e.target === targetId).flatMap(e => {
    const source = nodes.find(n => n.id === e.source && n.type === "mediaNode");
    return source ? [nodeAssetId(source)] : [];
  }))];
  for (const plan of plans) {
    const edge = edges.find(e => e.source === plan.nodeId && e.target === targetId);
    const confirmed = promptBindingsSchema.safeParse((edge?.data?.promptReference as { bindings?: unknown } | undefined)?.bindings ?? (plan.bindings.length === 0 ? [] : undefined));
    if (!confirmed.success || JSON.stringify(confirmed.data) !== JSON.stringify(plan.bindings)) planError(plan.nodeId, confirmed.success ? confirmed.data : plan.bindings, "素材待同步，请先同步素材到目标");
    for (const binding of plan.bindings) {
      if (!directIds.includes(binding.assetId) || !inputIds.includes(binding.assetId)) planError(plan.nodeId, [binding], "提示词引用的素材缺失或不完整，请补充素材或移除对应引用后再生成");
    }
    if (args.type !== "video") validatePlanModel(plan.nodeId, plan.bindings, inputIds.length, args.model);
  }
  if (directIds.length !== inputIds.length || directIds.some(id => !inputIds.includes(id)) || new Set(inputIds).size !== inputIds.length) {
    planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), "参考清单与目标直接连线不一致");
  }
  const resolved = await args.assets.resolveInputAssets(inputIds, args.userId, args.projectId);
  for (const id of inputIds) {
    if (!resolved.some(a => a.id === id && (args.type === "video" || a.type === "image") && /^https?:\/\//.test(a.url))) {
      const plan = plans.find(p => p.bindings.some(b => b.assetId === id)) ?? plans[0]!;
      planError(plan.nodeId, plan.bindings.filter(b => b.assetId === id), "素材已删除、无权访问或类型不受支持");
    }
  }
  let videoReferences: PromptPlanSnapshot["videoReferences"];
  if (args.type === "video") {
    const refs = args.references ?? [];
    const target = nodes.find(n => n.id === targetId);
    const materials = Array.isArray(target?.data?.draftMaterialRefs)
      ? target.data.draftMaterialRefs as Array<{ materialId: string; mediaType: string; role: string; url: string }> : [];
    videoReferences = refs.map(ref => {
      if (ref.material_id) {
        const material = materials.find(m => m.materialId === ref.material_id);
        const role = material?.role === "first" ? "first_frame" : material?.role === "last" ? "last_frame" : "reference";
        if (!material || material.mediaType !== ref.type || role !== ref.role || !/^https?:\/\//.test(material.url)) {
          planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), "素材库参考与目标已保存输入不一致");
        }
        return { materialId: ref.material_id, type: ref.type, role: ref.role, url: material.url, providerUrl: `asset://${ref.material_id}` };
      }
      const asset = resolved.find(a => a.id === ref.asset_id);
      const edge = edges.find(e => e.target === targetId && nodeAssetId(nodes.find(n => n.id === e.source)) === ref.asset_id);
      const role = edge?.data?.refRole === "first" ? "first_frame" : edge?.data?.refRole === "last" ? "last_frame" : "reference";
      if (!asset || asset.type !== ref.type || ref.role !== role) planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), "素材类型、身份或角色与目标连线不一致");
      return { assetId: asset.id, type: ref.type, role: ref.role, url: asset.url, providerUrl: asset.material_id ? `asset://${asset.material_id}` : asset.url };
    });
    const identities = videoReferences.map(r => r.providerUrl);
    if (new Set(identities).size !== identities.length) planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), "同一供应商素材存在重复索引，请调整引用");
    validateVideoPlan(plans[0]!.nodeId, plans.flatMap(p => p.bindings), videoReferences, args.model, nodes.find(n => n.id === targetId)?.data?.draftMode);
    try { validateReferences(args.model!.model_id, resolved.filter(a => refs.some(r => r.asset_id === a.id && r.role === "reference")), refs.filter(r => r.material_id && r.role === "reference").map(r => ({ id: r.material_id!, type: r.type }))); }
    catch (error) { planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), error instanceof Error ? error.message : "素材不受支持"); }
    if (materials.some(m => !refs.some(r => r.material_id === m.materialId))) {
      planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), "目标已有素材库参考缺失，请恢复参考清单");
    }
  }
  const compiled = attachments.map(attachment => {
    const plan = plans.find(p => p.nodeId === attachment.node_id);
    if (!plan) return attachment;
    let text = plan.text;
    for (const mention of [...plan.mentions].sort((a, b) => b.start - a.start)) {
      const index = inputIds.indexOf(mention.assetId);
      const ref = videoReferences?.find(r => r.assetId === mention.assetId);
      const label = ref ? ref.role === "first_frame" ? "首帧" : ref.role === "last_frame" ? "尾帧"
        : `${{ image: "参考图", video: "参考视频", audio: "参考音频" }[ref.type]}${videoReferences!.filter(r => r.type === ref.type && r.role === "reference").indexOf(ref) + 1}`
        : `参考图${index + 1}`;
      text = text.slice(0, mention.start) + label + text.slice(mention.end);
    }
    return { ...attachment, text };
  });
  const providerPrompt = composeTextAttachmentPrompt(compiled, args.prompt);
  const maxLength = Math.max(
    args.type === "video" ? COMPOSED_VIDEO_PROMPT_MAX_LENGTH : COMPOSED_IMAGE_PROMPT_MAX_LENGTH,
    args.model?.features.max_prompt_length ?? 0,
  );
  if (!providerPrompt.trim() || providerPrompt.length > maxLength) planError(plans[0]!.nodeId, plans[0]!.bindings, "标签转换后的提示词为空或超限");
  return { canvasVersion: args.version, plans: plans.map(({ nodeId, text, mentions }) => ({ nodeId, text, mentions })),
    ...(videoReferences ? { videoReferences } : {}),
    images: (videoReferences ? [] : inputIds).map(assetId => ({ assetId, url: resolved.find(a => a.id === assetId)!.url })), providerPrompt };
}
