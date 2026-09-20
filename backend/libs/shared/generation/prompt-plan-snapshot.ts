import { validateReferences } from "../generation-runtime/video-reference-validation.js";
import { resolvePromptMaxLength, type CanvasEdge, type PromptPlanSnapshot, type TextAttachmentSnapshot } from "@lib/contracts";
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
        const materialId = ref.material_id;
        // IKG79Z：素材库素材有两种落点——① 纯素材库引用（落不了画布节点）存目标节点的 draftMaterialRefs；
        // ② 素材有本地 asset 行时它会落成画布节点（节点同时带 assetId 与 materialId），**不进** draftMaterialRefs。
        // 只认 ① 会让 ② 这条路的生成恒 400「素材库参考与目标已保存输入不一致」（测试环境 project 492 实证）。
        const saved = materials.find(m => m.materialId === materialId);
        // 节点选择按「能完整表达这条引用」筛：排除目标自身（目标不能当自己的参考来源）、媒体类型须与请求一致、
        // 素材未被判失效（对齐 prompt-target.ts 其余画布来源检查）。只按 materialId 取首个的话，
        // 同一 materialId 的类型不符节点会先命中并被误拒。
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
        // 走画布节点这条回退时角色以请求体为准（同 IKG4RV 口径；节点上没有存角色）。
        const url = typeof node?.data?.src === "string" ? node.data.src : "";
        if (!node || !/^https?:\/\//.test(url)) {
          planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), "素材库参考与目标已保存输入不一致");
        }
        // 这里的 url 只进快照供审计：worker 出站只认 providerUrl（asset://<materialId>），
        // 素材本身是否可用由生成接纳处的合规门按调用方身份向上游核验。
        return { materialId, type: ref.type, role: ref.role, url, providerUrl: `asset://${materialId}` };
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
  // IKG6EK / ADR-0088：正文由提交方给全，引用标记转移已在接纳管线完成
  // （transfer-reference-markers.ts）——本函数不再组合 providerPrompt，附件正文也不再由
  // 服务端拼进正文。方案快照退为方案绑定校验与审计事实。
  // IKH4B8：上限改为**模型配置优先**（原取大吞掉了小于契约预算的配置），未配置回落组合缺省。
  const maxLength = resolvePromptMaxLength("composed", args.type ?? "image", args.model?.features.max_prompt_length ?? null);
  if (!args.prompt.trim() || args.prompt.length > maxLength) planError(plans[0]!.nodeId, plans[0]!.bindings, "提示词为空或超限");
  return { canvasVersion: args.version, plans: plans.map(({ nodeId, text, mentions }) => ({ nodeId, text, mentions })),
    ...(videoReferences ? { videoReferences } : {}),
    images: (videoReferences ? [] : inputIds).map(assetId => ({ assetId, url: resolved.find(a => a.id === assetId)!.url })) };
}
