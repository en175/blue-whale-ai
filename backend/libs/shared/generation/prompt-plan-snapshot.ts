import { validateReferences } from "../generation-runtime/video-reference-validation.js";
import { composeTextAttachmentPrompt, composeTextAttachmentPromptIndexed } from "@lib/core";
import { COMPOSED_IMAGE_PROMPT_MAX_LENGTH, COMPOSED_VIDEO_PROMPT_MAX_LENGTH, type CanvasEdge, type PromptPlanSnapshot, type TextAttachmentSnapshot } from "@lib/contracts";
import { docHasTextRef, type PromptDoc } from "@lib/contracts";
import { MISSING_PROMPT_REF_REASON, planError, readPromptPlan, validatePlanModel, validateVideoPlan, type PromptTargetNode } from "../canvas/prompt-target.js";
import type { ModelCapabilityView } from "../persistence/model-capability-repo.js";
import type { AssetOwnershipOps } from "../persistence/asset-ownership-types.js";

export async function freezePromptPlans(args: {
  nodes: PromptTargetNode[]; edges: CanvasEdge[]; version: number; targetId: string;
  type?: "image" | "video";
  references?: Array<{ asset_id?: string; material_id?: string; type: "image" | "video" | "audio"; role: "reference" | "first_frame" | "last_frame" }>;
  inputIds: string[]; prompt: string; attachments: TextAttachmentSnapshot[];
  /** IKFA1P：正文含文本标签时组合按编号清单格式（正文 文本N 与清单行号建立编号 ↔ 内容关系）。 */
  promptDoc?: PromptDoc | null;
  model: ModelCapabilityView | undefined; userId: string; projectId: string;
  assets: Pick<AssetOwnershipOps, "resolveInputAssets">;
}): Promise<PromptPlanSnapshot | undefined> {
  const { nodes, edges, targetId, attachments } = args;
  // 重复素材会让组合正文的参考编号漂移，也不合 resolveInputAssets 的单份归属语义；入口先去重
  const inputIds = [...new Set(args.inputIds)];
  const planNodes = attachments.flatMap(a => {
    const n = nodes.find(n => n.id === a.node_id);
    const edge = edges.find(e => e.source === a.node_id && e.target === targetId);
    return n?.data?.promptSource && (n.data.promptMentions !== undefined || edge?.data?.promptReference !== undefined) ? [n] : [];
  });
  if (!planNodes.length) return undefined;
  const plans = planNodes.map(n => readPromptPlan(n, args.type));
  // IKG79Z：方案绑定以**本地 assetId** 表达，素材库引用在请求体里以 **material_id** 表达——同一媒体的两种身份。
  // 只按 assetId 比对会把「方案卡 + 素材库素材」整条路径误判成素材缺失（测试环境 project 492 实证：
  // 该场景请求只带 material_id，而 video 分支的 inputIds 只收 asset_id，两者永远对不上）。
  // 判定成立的前提是 `assets.material_id` 上有全表唯一索引（一对一）：请求里的 material 命中某个本地 asset
  // 的 material_id，就等价于「这个 asset 是它的本地代表行」，不是「看着像就放行」。
  // 映射只在 resolveInputAssets 的归属结果上建立——归属不通过（越权/已删）的 asset 不建立映射，
  // 下面照旧按 MISSING_PROMPT_REF_REASON 报缺失，越权边界不放松。
  // 只对 video 生效：material 引用仅视频生成可用，且只有 video 分支产出 videoReferences 供标签回查；
  // 不分类型会让 image 目标放行成「参考图0 + 零参考」的静默降级。
  const requestedMaterialIds = new Set((args.references ?? []).flatMap(r => (r.material_id ? [r.material_id] : [])));
  const unmatchedIds = [...new Set(plans.flatMap(p => p.bindings.map(b => b.assetId)))].filter(id => !inputIds.includes(id));
  const materialBackedIds = new Map<string, string>();
  if (args.type === "video" && unmatchedIds.length && requestedMaterialIds.size) {
    for (const asset of await args.assets.resolveInputAssets(unmatchedIds, args.userId, args.projectId)) {
      if (asset.material_id && requestedMaterialIds.has(asset.material_id)) materialBackedIds.set(asset.id, asset.material_id);
    }
  }
  // IKG4RV：生成输入以提交请求为准——方案引用不再要求画布上有一条落到库的连线（连线降级为 UI 表达）。
  // 但保留下半条「方案声明的素材必须真的在本次请求里」：少了它，正文仍写着 @图N 而素材不在请求里时，
  // 标签会退化成「参考图0」静默送上游，违反 IKE5G8 §7.3「不静默裁剪后生成」与决策 D7「不静默丢弃素材」。
  // 素材可用性另由下方 resolveInputAssets 归属校验与 validatePlanModel / validateVideoPlan 把关。
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
        const material = materials.find(m => m.materialId === ref.material_id);
        const role = material?.role === "first" ? "first_frame" : material?.role === "last" ? "last_frame" : "reference";
        if (!material || material.mediaType !== ref.type || role !== ref.role || !/^https?:\/\//.test(material.url)) {
          planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), "素材库参考与目标已保存输入不一致");
        }
        return { materialId: ref.material_id, type: ref.type, role: ref.role, url: material.url, providerUrl: `asset://${ref.material_id}` };
      }
      const asset = resolved.find(a => a.id === ref.asset_id);
      // IKG4RV：首帧/尾帧角色以请求体 references[].role 为准，不再从连线 refRole 反推比对。
      if (!asset || asset.type !== ref.type) planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), "素材类型与请求不一致");
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
      // IKG79Z：素材库引用在 videoReferences 里以 materialId 表达，按上面的身份映射回查，
      // 否则这里取不到 ref 会退化成 `参考图0`（index 为 -1）——正是保留那条校验要防的静默降级。
      const materialId = materialBackedIds.get(mention.assetId);
      const ref = videoReferences?.find(r => r.assetId === mention.assetId || (materialId !== undefined && r.materialId === materialId));
      const label = ref ? ref.role === "first_frame" ? "首帧" : ref.role === "last_frame" ? "尾帧"
        : `${{ image: "参考图", video: "参考视频", audio: "参考音频" }[ref.type]}${videoReferences!.filter(r => r.type === ref.type && r.role === "reference").indexOf(ref) + 1}`
        : `参考图${index + 1}`;
      text = text.slice(0, mention.start) + label + text.slice(mention.end);
    }
    return { ...attachment, text };
  });
  // IKFA1P：正文含文本标签时按编号清单组合（正文 文本N 字样与附件清单行号对应）；
  // 方案附件正文经上方标签替换后原样进入清单，保持既有方案绑定/同步约束。
  const providerPrompt = args.promptDoc && docHasTextRef(args.promptDoc)
    ? composeTextAttachmentPromptIndexed(compiled, args.prompt)
    : composeTextAttachmentPrompt(compiled, args.prompt);
  const maxLength = Math.max(
    args.type === "video" ? COMPOSED_VIDEO_PROMPT_MAX_LENGTH : COMPOSED_IMAGE_PROMPT_MAX_LENGTH,
    args.model?.features.max_prompt_length ?? 0,
  );
  if (!providerPrompt.trim() || providerPrompt.length > maxLength) planError(plans[0]!.nodeId, plans[0]!.bindings, "标签转换后的提示词为空或超限");
  return { canvasVersion: args.version, plans: plans.map(({ nodeId, text, mentions }) => ({ nodeId, text, mentions })),
    ...(videoReferences ? { videoReferences } : {}),
    images: (videoReferences ? [] : inputIds).map(assetId => ({ assetId, url: resolved.find(a => a.id === assetId)!.url })), providerPrompt };
}
