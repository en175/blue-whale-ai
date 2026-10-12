import { validateReferences } from "../generation-runtime/video-reference-validation.js";
import { resolvePromptMaxLength, normalizeVideoMode, type CanvasEdge, type PromptPlanSnapshot, type TextAttachmentSnapshot } from "@lib/contracts";
import { MISSING_PROMPT_REF_REASON, planError, readPromptPlan, validatePlanModel, validateVideoPlan, type PromptTargetNode } from "../canvas/prompt-target.js";
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
  const { nodes, edges, targetId, attachments } = args;
  const inputIds = [...new Set(args.inputIds)];
  const planNodes = attachments.flatMap(a => {
    const n = nodes.find(n => n.id === a.node_id);
    const edge = edges.find(e => e.source === a.node_id && e.target === targetId);
    return n?.data?.promptSource && (n.data.promptMentions !== undefined || edge?.data?.promptReference !== undefined) ? [n] : [];
  });
  if (!planNodes.length) return undefined;
  const plans = planNodes.map(n => readPromptPlan(n, args.type));
  const requestedMaterialIds = new Set((args.references ?? []).flatMap(r => (r.material_id ? [r.material_id] : [])));
  const unmatchedIds = [...new Set(plans.flatMap(p => p.bindings.map(b => b.assetId)))].filter(id => !inputIds.includes(id));
  const materialBackedIds = new Map<string, string>();
  if (args.type === "video" && unmatchedIds.length && requestedMaterialIds.size) {
    for (const asset of await args.assets.resolveInputAssets(unmatchedIds, args.userId, args.projectId)) {
      if (asset.material_id && requestedMaterialIds.has(asset.material_id)) materialBackedIds.set(asset.id, asset.material_id);
    }
  }
  for (const plan of plans) {
    for (const binding of plan.bindings) {
      if (!inputIds.includes(binding.assetId) && !materialBackedIds.has(binding.assetId)) {
        planError(plan.nodeId, [binding], MISSING_PROMPT_REF_REASON);
      }
    }
    if (args.type !== "video") validatePlanModel(plan.nodeId, plan.bindings, inputIds.length, args.model);
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
        const materialId = ref.material_id;
        const saved = materials.find(m => m.materialId === materialId);
        const node = saved ? undefined : nodes.find(n =>
          n.id !== targetId && n.type === "mediaNode"
          && String(n.data?.materialId ?? "").toLowerCase() === materialId.toLowerCase()
          && String(n.data?.mediaType ?? "") === ref.type
          && !n.data?.assetMissing);
        if (saved) {
          const role = saved.role === "first" ? "first_frame" : saved.role === "last" ? "last_frame" : "reference";
          if (saved.mediaType !== ref.type || role !== ref.role || !/^https?:\/\//.test(saved.url)) {
            planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), "素材库参考与目标已保存输入不一致");
          }
          return { materialId, type: ref.type, role: ref.role, url: saved.url, providerUrl: `asset://${materialId}` };
        }
        const url = typeof node?.data?.src === "string" ? node.data.src : "";
        if (!node || !/^https?:\/\//.test(url)) {
          planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), "素材库参考与目标已保存输入不一致");
        }
        return { materialId, type: ref.type, role: ref.role, url, providerUrl: `asset://${materialId}` };
      }
      const asset = resolved.find(a => a.id === ref.asset_id);
      if (!asset || asset.type !== ref.type) planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), "素材类型与请求不一致");
      return { assetId: asset.id, type: ref.type, role: ref.role, url: asset.url, providerUrl: asset.material_id ? `asset://${asset.material_id}` : asset.url };
    });
    const identities = videoReferences.map(r => r.providerUrl);
    if (new Set(identities).size !== identities.length) planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), "同一供应商素材存在重复索引，请调整引用");
    const draftMode = normalizeVideoMode(nodes.find(n => n.id === targetId)?.data?.draftMode);
    validateVideoPlan(plans[0]!.nodeId, plans.flatMap(p => p.bindings), videoReferences, args.model, draftMode);
    try { validateReferences(args.model!.features, resolved.filter(a => refs.some(r => r.asset_id === a.id && r.role === "reference")), refs.filter(r => r.material_id && r.role === "reference").map(r => ({ id: r.material_id!, type: r.type })), draftMode); }
    catch (error) { planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), error instanceof Error ? error.message : "素材不受支持"); }
    if (materials.some(m => !refs.some(r => r.material_id === m.materialId))) {
      planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), "目标已有素材库参考缺失，请恢复参考清单");
    }
  }
  const maxLength = resolvePromptMaxLength(args.type ?? "image", args.model?.features.max_prompt_length ?? null);
  if (!args.prompt.trim() || args.prompt.length > maxLength) planError(plans[0]!.nodeId, plans[0]!.bindings, "提示词为空或超限");
  return { canvasVersion: args.version, plans: plans.map(({ nodeId, text, mentions }) => ({ nodeId, text, mentions })),
    ...(videoReferences ? { videoReferences } : {}),
    images: (videoReferences ? [] : inputIds).map(assetId => ({ assetId, url: resolved.find(a => a.id === assetId)!.url })) };
}
